#!/usr/bin/env node
// software-factory/swr-agent.mjs
//
// The bridge between GitHub Actions and MiniMax. It takes an agent name and
// a task, resolves the route from routing.config.json, and calls the
// MiniMax Anthropic-compatible Messages endpoint.
//
// WHY THE ANTHROPIC SHAPE
// -----------------------
// MiniMax exposes https://api.minimax.io/anthropic/v1/messages, which speaks
// the Anthropic Messages API. So the wire format stays Anthropic and only the
// provider block changes: base URL, auth header, model ids, thinking control.
// Anything that already speaks Anthropic (the Anthropic SDK, Claude Code with
// a custom base URL, a proxy) can point at the same endpoint.
//
// ZERO DEPENDENCIES ON PURPOSE
// ----------------------------
// The factory runs in CI on a bare `npm ci` of a repo that has no LLM SDK in
// its tree. A global fetch (Node 18+) is the whole transport.
//
// USAGE
//   node software-factory/swr-agent.mjs run --agent SWR-Ops --task triage
//   node software-factory/swr-agent.mjs run --agent SWR-Check --task verification \
//        --diff "$(git diff origin/main...)" --json
//   node software-factory/swr-agent.mjs run --agent SWR-Ops --task planning \
//        --context-file drift.txt --allow-writes
//   node software-factory/swr-agent.mjs models          # live catalog from MiniMax
//   node software-factory/swr-agent.mjs show --agent SWR-Ops   # resolved route
//   node software-factory/swr-agent.mjs run --agent SWR-Ops --task triage --dry-run
//
// EXIT CODES
//   0  success
//   1  runtime / API error
//   2  usage or configuration error (bad agent, unknown model, missing key)

import { readFileSync, existsSync, appendFileSync, writeFileSync, statSync } from 'node:fs';
import { resolve, dirname, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface as readline } from 'node:readline';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const CONFIG_PATH = resolve(HERE, 'routing.config.json');

// ---------------------------------------------------------------- config ---

function loadConfig() {
  if (!existsSync(CONFIG_PATH)) {
    fail(2, `routing config not found at ${CONFIG_PATH}`);
  }
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  } catch (err) {
    fail(2, `routing config is not valid JSON: ${err.message}`);
  }
}

function fail(code, message) {
  process.stderr.write(`swr-agent: ${message}\n`);
  process.exit(code);
}

// ------------------------------------------------------------------ args ---

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      args._.push(token);
      continue;
    }
    const eq = token.indexOf('=');
    if (eq !== -1) {
      args[token.slice(2, eq)] = token.slice(eq + 1);
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      i++;
    }
  }
  return args;
}

// ----------------------------------------------------------------- routes ---

// A task is either one of the agent's model keys (planning / triage / …) or
// the name of a trigger (issue_opened / pr_opened / …). Triggers win when the
// name collides, because a trigger carries its own model AND its own prompt.
function resolveRoute(config, agentName, taskName) {
  const agent = config.agents?.[agentName];
  if (!agent) {
    const known = Object.keys(config.agents || {}).join(', ');
    fail(2, `unknown agent "${agentName}". Known agents: ${known}`);
  }
  if (!taskName) {
    return { agent, model: agent.model_default, task: null, trigger: null };
  }

  const trigger = config.triggers?.[taskName];
  if (trigger) {
    if (trigger.agent !== agentName) {
      fail(2, `trigger "${taskName}" belongs to ${trigger.agent}, not ${agentName}`);
    }
    return {
      agent,
      model: trigger.model,
      task: trigger.task || taskName,
      trigger,
      maxTokens: trigger.max_tokens,
    };
  }

  const model = agent.models?.[taskName] || agent.model_default;
  return { agent, model, task: taskName, trigger: null };
}

function resolveSystemPrompt(agent) {
  const path = agent.system_prompt;
  if (!path) return '';
  const abs = isAbsolute(path) ? path : resolve(REPO_ROOT, path);
  if (!existsSync(abs)) {
    fail(2, `system prompt file not found for ${agent.role}: ${path}`);
  }
  return readFileSync(abs, 'utf8');
}

// ------------------------------------------------------------------ cost ---

function estimateCost(model, usage) {
  const entry = loadConfig().model_catalog?.[model];
  if (!entry || !usage) return null;
  const p = entry.pricing || {};
  const inTok = usage.input_tokens || 0;
  const outTok = usage.output_tokens || 0;
  const cacheTok = usage.cache_read_input_tokens || 0;
  const usd =
    (inTok * (p.input_per_mtok || 0)) / 1e6 +
    (outTok * (p.output_per_mtok || 0)) / 1e6 +
    (cacheTok * (p.cache_read_per_mtok || 0)) / 1e6;
  return {
    usd: Number(usd.toFixed(6)),
    input_tokens: inTok,
    output_tokens: outTok,
    cache_read_input_tokens: cacheTok,
    pricing: p,
  };
}

// ----------------------------------------------------------------- tools ---

function writeToolSchema() {
  return {
    name: 'write_file',
    description:
      'Append or overwrite a repository file. Only paths on the allowlist are accepted. ' +
      'Prefer appending to a task log over rewriting a file you did not read.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Repo-relative path.' },
        content: { type: 'string', description: 'Content to write.' },
        mode: { type: 'string', enum: ['append', 'overwrite'], description: 'Defaults to append.' },
      },
      required: ['path', 'content'],
    },
  };
}

function readToolSchema() {
  return {
    name: 'read_file',
    description:
      'Read a file from the repository or the twin knowledge root. Returns the text content. ' +
      'Paths outside the allowed roots are refused.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path relative to the repo root or the twin root.' },
        root: { type: 'string', enum: ['repo', 'twin'], description: 'Which root to resolve against.' },
      },
      required: ['path'],
    },
  };
}

// The read roots are deliberately explicit. "repo" is the SWR checkout,
// "twin" is the sibling digital_twin checkout the twin's voice lives in.
function readRoots() {
  return {
    repo: REPO_ROOT,
    twin: resolve(REPO_ROOT, '..', 'digital_twin'),
  };
}

function executeRead(config, input) {
  const roots = readRoots();
  const rootName = input?.root === 'twin' ? 'twin' : 'repo';
  const base = roots[rootName];
  if (!base || !existsSync(base)) {
    return { ok: false, message: `Read root "${rootName}" is not available on this machine.` };
  }
  const path = String(input?.path || '');
  if (!path) return { ok: false, message: 'read_file needs a path.' };
  const abs = resolve(base, path);
  // Refuse anything that escapes the root — a "../" in a model-authored
  // path must not reach outside the checkout.
  if (!abs.startsWith(base + '/') && abs !== base) {
    return { ok: false, message: `Path escapes the ${rootName} root: ${path}` };
  }
  if (!existsSync(abs)) {
    return { ok: false, message: `Not found in the ${rootName} root: ${path}` };
  }
  try {
    const stat = statSync(abs);
    if (stat.isDirectory()) {
      return { ok: false, message: `${path} is a directory. Read a file inside it.` };
    }
    const content = readFileSync(abs, 'utf8');
    const capped = content.length > 120000 ? `${content.slice(0, 120000)}\n… [truncated]` : content;
    return { ok: true, message: capped, content: capped };
  } catch (err) {
    return { ok: false, message: `Read failed for ${path}: ${err.message}` };
  }
}

function executeTool(config, agent, input, { allowWrites, dryRun }) {
  const allowlist = config.tools?.write_allowlist || [];
  const path = String(input?.path || '');
  const content = String(input?.content ?? '');
  const mode = input?.mode === 'overwrite' ? 'overwrite' : 'append';

  if (agent.read_only) {
    return { ok: false, message: `${agent.role} is read-only and cannot write files.` };
  }
  if (!allowlist.includes(path)) {
    return {
      ok: false,
      message: `Path not on the write allowlist: ${path}. Allowed: ${allowlist.join(', ')}`,
    };
  }
  if (!allowWrites) {
    return {
      ok: false,
      message: `Writes are disabled. Re-run with ${config.tools?.write_requires_flag || '--allow-writes'} to permit them.`,
    };
  }
  if (dryRun) {
    return { ok: true, message: `[dry-run] would ${mode} ${path} (${content.length} bytes)` };
  }
  try {
    if (mode === 'overwrite') writeFileSync(resolve(REPO_ROOT, path), content, 'utf8');
    else appendFileSync(resolve(REPO_ROOT, path), content, 'utf8');
    return { ok: true, message: `${mode === 'overwrite' ? 'Wrote' : 'Appended to'} ${path} (${content.length} bytes)` };
  } catch (err) {
    return { ok: false, message: `Write failed for ${path}: ${err.message}` };
  }
}

// -------------------------------------------------------------- transport ---

function buildRequestBody(config, { model, agent, task, maxTokens, effort, thinkingBudget, userText, dryRun }) {
  const catalog = config.model_catalog || {};
  const entry = catalog[model];
  if (!entry) {
    const known = Object.keys(catalog).join(', ');
    const hint = /^claude-/i.test(model)
      ? ' That looks like a Claude model id — this factory runs on MiniMax.'
      : '';
    fail(2, `unknown model "${model}".${hint} Known models: ${known}`);
  }

  // Ceiling = what the model can emit. Target = what we actually ask for.
  // The model's *recommended* value is a cap, not a target — asking for 128k
  // on a triage call would let one run spend a fortune on a one-line label.
  const cap = entry.max_output_tokens || config.defaults?.max_tokens || 16384;
  const target = config.defaults?.max_tokens || 16384;
  let tokens = maxTokens || target;
  if (tokens > cap) tokens = cap;

  const body = {
    model,
    max_tokens: tokens,
    system: resolveSystemPrompt(agent),
    messages: [{ role: 'user', content: userText }],
  };

  // Thinking. Flash always thinks and rejects {"type":"disabled"}; M3 defaults
  // to off and takes {"type":"adaptive"}; the M2.x family takes a budget.
  if (entry.supports?.thinking) {
    const thinking = entry.thinking || {};
    if (thinking.payload) body.thinking = { ...thinking.payload };
    if (thinking.mode === 'budget' && thinking.payload?.budget_tokens) {
      body.thinking.budget_tokens = thinking.payload.budget_tokens;
    }
    // A per-task budget overrides the model default — that is the only depth
    // knob the M2.x family has.
    if (thinkingBudget && thinking.mode === 'budget') {
      body.thinking.budget_tokens = thinkingBudget;
    }
  }

  // Thinking depth. Only MiniMax-M3.1-Flash accepts output_config.effort;
  // "none" is not a valid value and returns 400.
  if (effort && entry.supports?.effort) {
    const allowed = entry.effort_values || ['low', 'medium', 'high', 'xhigh', 'max'];
    if (!allowed.includes(effort)) {
      fail(2, `effort "${effort}" is not supported by ${model}. Allowed: ${allowed.join(', ')}`);
    }
    body.output_config = { ...(body.output_config || {}), effort };
  }

  // Every agent may read. Only agents that are not read-only may write,
  // and even then the path has to be on the allowlist.
  const tools = [readToolSchema()];
  if (!agent.read_only) tools.push(writeToolSchema());
  body.tools = tools;
  body.tool_choice = { type: 'auto' };

  return body;
}

async function callMiniMax(config, body, { timeoutMs, retries, dryRun }) {
  const provider = config.provider;
  const base = process.env.MINIMAX_BASE_URL || provider.base_url;
  const url = `${base.replace(/\/+$/, '')}${provider.messages_path}`;
  const apiKey = process.env[provider.api_key_env || 'MINIMAX_API_KEY'];

  const headers = {
    'Content-Type': 'application/json',
    'anthropic-version': provider.anthropic_version || '2023-06-01',
  };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  if (dryRun) {
    return { dryRun: true, url, headers: { ...headers, Authorization: apiKey ? 'Bearer ***' : '(unset)' }, body };
  }
  if (!apiKey) {
    fail(2, `${provider.api_key_env || 'MINIMAX_API_KEY'} is not set. Export it or add it as a repo secret.`);
  }

  let lastError = null;
  for (let attempt = 0; attempt <= (retries ?? 0); attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs || 600000);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timer);

      const text = await res.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        fail(1, `MiniMax returned non-JSON (HTTP ${res.status}): ${text.slice(0, 500)}`);
      }

      if (!res.ok) {
        const baseResp = json?.base_resp;
        const detail = baseResp
          ? `status_code=${baseResp.status_code} status_msg=${baseResp.status_msg || ''}`
          : json?.error?.message || text.slice(0, 300);
        const retryable = (config.defaults?.retry_on || [429, 500, 502, 503, 504]).includes(res.status);
        lastError = `HTTP ${res.status} from MiniMax: ${detail}`;
        if (retryable && attempt < (retries ?? 0)) {
          const backoff = 1000 * 4 ** attempt;
          process.stderr.write(`swr-agent: ${lastError} — retrying in ${backoff}ms\n`);
          await new Promise((r) => setTimeout(r, backoff));
          continue;
        }
        fail(1, lastError);
      }
      return json;
    } catch (err) {
      clearTimeout(timer);
      if (err?.name === 'AbortError') {
        fail(1, `MiniMax request timed out after ${timeoutMs}ms`);
      }
      lastError = err.message;
      if (attempt < (retries ?? 0)) {
        const backoff = 1000 * 4 ** attempt;
        process.stderr.write(`swr-agent: ${lastError} — retrying in ${backoff}ms\n`);
        await new Promise((r) => setTimeout(r, backoff));
        continue;
      }
      fail(1, `MiniMax request failed: ${lastError}`);
    }
  }
  fail(1, lastError || 'MiniMax request failed');
}

function extractText(content) {
  if (!Array.isArray(content)) return '';
  return content
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n')
    .trim();
}

function extractThinking(content) {
  if (!Array.isArray(content)) return '';
  return content
    .filter((b) => b.type === 'thinking' && typeof b.thinking === 'string')
    .map((b) => b.thinking)
    .join('\n')
    .trim();
}

function extractToolCalls(content) {
  if (!Array.isArray(content)) return [];
  return content.filter((b) => b.type === 'tool_use').map((b) => ({ id: b.id, name: b.name, input: b.input }));
}

// ------------------------------------------------------------- user text ---

function assembleUserText(config, args, route) {
  const parts = [];

  const prompt = args.prompt || config.prompts?.[route.task];
  if (prompt) parts.push(prompt);

  if (args.context) parts.push(`\n--- CONTEXT ---\n${args.context}`);
  if (args['context-file']) {
    const p = resolve(REPO_ROOT, args['context-file']);
    if (!existsSync(p)) fail(2, `context file not found: ${args['context-file']}`);
    parts.push(`\n--- CONTEXT (${args['context-file']}) ---\n${readFileSync(p, 'utf8')}`);
  }

  if (args.files) {
    const list = String(args.files).split(',').map((s) => s.trim()).filter(Boolean);
    for (const f of list) {
      const p = resolve(REPO_ROOT, f);
      if (!existsSync(p)) fail(2, `file not found: ${f}`);
      parts.push(`\n--- FILE ${f} ---\n${readFileSync(p, 'utf8')}`);
    }
  }

  if (args.diff) parts.push(`\n--- DIFF ---\n${args.diff}`);
  if (args['diff-file']) {
    const p = resolve(REPO_ROOT, args['diff-file']);
    if (!existsSync(p)) fail(2, `diff file not found: ${args['diff-file']}`);
    parts.push(`\n--- DIFF (${args['diff-file']}) ---\n${readFileSync(p, 'utf8')}`);
  }

  if (!parts.length) {
    fail(2, 'nothing to send: pass --prompt, --context, --context-file, --files or --diff');
  }
  return parts.join('\n');
}

// ------------------------------------------------------------------ turns ---

// One model turn: call MiniMax and pull the pieces out of the response.
async function modelTurn(config, body, transport) {
  const response = await callMiniMax(config, body, transport);
  return {
    response,
    text: extractText(response.content),
    thinking: extractThinking(response.content),
    toolCalls: extractToolCalls(response.content),
  };
}

// Execute the tools a turn asked for, then push the assistant turn and the
// tool results back into the conversation so the model can continue.
function runToolCalls(config, route, body, response, toolCalls, { allowWrites, toolLog = [] }) {
  const toolResults = [];
  for (const call of toolCalls) {
    let result;
    if (call.name === 'read_file') {
      result = executeRead(config, call.input);
    } else if (call.name === 'write_file') {
      result = executeTool(config, route.agent, call.input, { allowWrites, dryRun: false });
    } else {
      result = { ok: false, message: `Unknown tool: ${call.name}` };
    }
    toolLog.push({ name: call.name, input: call.input, ok: result.ok, message: result.message });
    toolResults.push({
      type: 'tool_result',
      tool_use_id: call.id,
      content: result.ok ? result.message : `ERROR: ${result.message}`,
      is_error: !result.ok,
    });
  }
  body.messages.push({ role: 'assistant', content: response.content });
  body.messages.push({ role: 'user', content: toolResults });
  return toolLog;
}

// -------------------------------------------------------------- commands ---

async function cmdRun(args) {
  const config = loadConfig();
  const route = resolveRoute(config, args.agent, args.task);
  const model = args.model || route.model;
  const reasoning = route.agent.reasoning?.[route.task] || {};
  const effort = args.effort || reasoning.effort;
  const thinkingBudget = args['thinking-budget']
    ? Number(args['thinking-budget'])
    : reasoning.thinking_budget_tokens;

  const userText = assembleUserText(config, args, route);
  const dryRun = Boolean(args['dry-run']);

  let body = buildRequestBody(config, {
    model,
    agent: route.agent,
    task: route.task,
    maxTokens: args['max-tokens'] ? Number(args['max-tokens']) : route.maxTokens,
    effort,
    thinkingBudget,
    userText,
    dryRun,
  });

  const transport = { timeoutMs: Number(args.timeout) || config.defaults?.timeout_ms, retries: config.defaults?.retries, dryRun };

  if (dryRun) {
    const preview = await callMiniMax(config, body, transport);
    process.stdout.write(JSON.stringify(preview, null, 2) + '\n');
    return 0;
  }

  const results = [];
  const toolLog = [];

  for (let turn = 0; turn < 3; turn++) {
    const { response, text, thinking, toolCalls } = await modelTurn(config, body, transport);

    if (thinking && args.verbose) process.stderr.write(`[thinking]\n${thinking}\n`);

    if (!toolCalls.length) {
      results.push({
        model: response.model || model,
        stop_reason: response.stop_reason,
        text,
        thinking: args.verbose ? thinking : undefined,
        usage: response.usage,
        cost: estimateCost(response.model || model, response.usage),
        tool_calls: toolLog,
      });
      break;
    }

    runToolCalls(config, route, body, response, toolCalls, {
      allowWrites: Boolean(args['allow-writes']),
      toolLog,
    });
  }
  const payload = results[0] || { model, text: '', usage: null, cost: null, tool_calls: toolLog };

  if (args.json) {
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
  } else {
    if (payload.text) process.stdout.write(payload.text + '\n');
    if (payload.cost) {
      process.stderr.write(
        `\n[swr-agent] ${payload.model} · in ${payload.cost.input_tokens} / out ${payload.cost.output_tokens}` +
          ` tokens · $${payload.cost.usd}\n`,
      );
    }
    for (const call of payload.tool_calls || []) {
      process.stderr.write(`[tool] ${call.name} → ${call.ok ? 'ok' : 'refused'}: ${call.message}\n`);
    }
  }
  return 0;
}

// An interactive session — the local equivalent of the three Claude
// sessions the old start-team.sh opened. One agent, one model, one
// conversation, and the same tool rules the CI factory uses.
async function cmdInteractive(args) {
  const config = loadConfig();
  const route = resolveRoute(config, args.agent, args.task);
  const model = args.model || route.model;
  const reasoning = route.agent.reasoning?.[route.task] || {};
  const effort = args.effort || reasoning.effort;
  const thinkingBudget = args['thinking-budget']
    ? Number(args['thinking-budget'])
    : reasoning.thinking_budget_tokens;

  const transport = {
    timeoutMs: Number(args.timeout) || config.defaults?.timeout_ms,
    retries: config.defaults?.retries,
    dryRun: false,
  };

  const body = buildRequestBody(config, {
    model,
    agent: route.agent,
    task: route.task,
    maxTokens: args['max-tokens'] ? Number(args['max-tokens']) : route.maxTokens,
    effort,
    thinkingBudget,
    userText:
      args.prompt ||
      config.prompts?.[route.task] ||
      'You are online. Introduce yourself in two sentences, then wait for instructions.',
    dryRun: false,
  });

  const banner = `▌ ${args.agent} · ${model}${route.agent.read_only ? ' · read-only' : ''}`;
  process.stderr.write(`${banner}\n  /exit to quit\n`);

  const greeting = await modelTurn(config, body, transport);
  body.messages.push({ role: 'assistant', content: greeting.response.content });
  if (greeting.text) process.stdout.write(`${greeting.text}\n`);

  const rl = readline({ input: process.stdin, output: process.stdout, prompt: '> ' });
  rl.prompt();
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) {
      rl.prompt();
      continue;
    }
    if (trimmed === '/exit' || trimmed === '/quit') break;

    body.messages.push({ role: 'user', content: trimmed });
    for (let turn = 0; turn < 3; turn++) {
      const t = await modelTurn(config, body, transport);
      if (t.thinking && args.verbose) process.stderr.write(`[thinking]\n${t.thinking}\n`);
      if (t.text) process.stdout.write(`${t.text}\n`);
      if (!t.toolCalls.length) break;
      const log = runToolCalls(config, route, body, t.response, t.toolCalls, {
        allowWrites: Boolean(args['allow-writes']),
      });
      for (const call of log) {
        process.stderr.write(`[tool] ${call.name} → ${call.ok ? 'ok' : 'refused'}: ${call.message}\n`);
      }
    }
    rl.prompt();
  }
  rl.close();
  return 0;
}

// A local self-test for the guard rails. No API key, no network — this is
// what the CI selftest job runs, and what you run when you want to know the
// bridge cannot be talked into writing outside the allowlist.
async function cmdSelfTest(args) {
  const config = loadConfig();
  let failed = 0;
  const ok = (msg) => process.stdout.write(`✓ ${msg}\n`);
  const bad = (msg) => {
    process.stderr.write(`✗ ${msg}\n`);
    failed++;
  };

  const agent = config.agents['SWR-Ops'];
  const check = config.agents['SWR-Check'];

  // 1. a path that is not on the allowlist is refused
  let r = executeTool(config, agent, { path: 'package.json', content: 'x' }, { allowWrites: true, dryRun: true });
  if (r.ok) bad('write_file allowed a path outside the allowlist');
  else ok(`write refused off-allowlist: ${r.message}`);

  // 2. an allowlisted path is still refused without the flag
  const allowed = (config.tools?.write_allowlist || [])[0];
  r = executeTool(config, agent, { path: allowed, content: 'x' }, { allowWrites: false, dryRun: false });
  if (r.ok) bad('write_file wrote without --allow-writes');
  else ok(`write refused without the flag: ${r.message}`);

  // 3. with the flag it is permitted (dry run — nothing is touched)
  r = executeTool(config, agent, { path: allowed, content: 'x' }, { allowWrites: true, dryRun: true });
  if (!r.ok) bad(`write refused on an allowlisted path with the flag: ${r.message}`);
  else ok(`write allowed on the allowlist with the flag: ${r.message}`);

  // 4. a read-only agent cannot write at all
  r = executeTool(config, check, { path: allowed, content: 'x' }, { allowWrites: true, dryRun: true });
  if (r.ok) bad('a read-only agent was allowed to write');
  else ok(`read-only agent refused: ${r.message}`);

  // 5. read_file cannot escape its root
  r = executeRead(config, { path: '../../../etc/passwd' });
  if (r.ok) bad('read_file escaped the repo root');
  else ok(`read refused outside the root: ${r.message}`);

  // 6. read_file works inside the root
  r = executeRead(config, { path: 'package.json' });
  if (!r.ok) bad(`read_file failed on a repo file: ${r.message}`);
  else ok('read works inside the root');

  // 7. a Claude model id is rejected with a useful message
  const { spawnSync } = await import('node:child_process');
  const script = resolve(HERE, 'swr-agent.mjs');
  const res = spawnSync(process.execPath, [script, 'run', '--agent', 'SWR-Ops', '--task', 'planning', '--model', 'claude-3-opus-20240229', '--context', 'x'], { encoding: 'utf8' });
  if (res.status === 2 && /Claude model id/.test(res.stderr)) {
    ok('a Claude model id is rejected with a pointed message');
  } else {
    bad(`expected the Claude model id to be rejected (exit 2), got ${res.status}: ${res.stderr?.trim()}`);
  }

  if (failed) {
    process.stderr.write(`\n${failed} self-test(s) failed\n`);
    return 1;
  }
  process.stdout.write('✓ bridge self-test OK — the guards hold\n');
  return 0;
}

async function cmdModels(args) {  const config = loadConfig();
  const provider = config.provider;
  const base = process.env.MINIMAX_BASE_URL || provider.base_url;
  const url = `${base.replace(/\/+$/, '')}${provider.models_path}`;
  const apiKey = process.env[provider.api_key_env || 'MINIMAX_API_KEY'];
  if (!apiKey) fail(2, `${provider.api_key_env || 'MINIMAX_API_KEY'} is not set.`);
  if (args['dry-run']) {
    process.stdout.write(JSON.stringify({ url, headers: { 'X-Api-Key': '***' } }, null, 2) + '\n');
    return 0;
  }
  const res = await fetch(url, { headers: { 'X-Api-Key': apiKey, Authorization: `Bearer ${apiKey}` } });
  const text = await res.text();
  if (!res.ok) fail(1, `HTTP ${res.status} listing models: ${text.slice(0, 300)}`);
  const json = JSON.parse(text);
  const live = (json.data || []).map((m) => m.id);
  const configured = Object.keys(config.model_catalog || {});
  process.stdout.write(
    JSON.stringify(
      {
        live,
        configured,
        missing_from_live: configured.filter((m) => !live.includes(m)),
        unknown_to_config: live.filter((m) => !configured.includes(m)),
      },
      null,
      2,
    ) + '\n',
  );
  return 0;
}

function cmdShow(args) {
  const config = loadConfig();
  const route = resolveRoute(config, args.agent, args.task);
  const entry = config.model_catalog?.[route.model];
  process.stdout.write(
    JSON.stringify(
      {
        agent: args.agent,
        role: route.agent.role,
        task: route.task,
        trigger: route.trigger ? Object.keys(config.triggers).find((t) => config.triggers[t] === route.trigger) : null,
        model: route.model,
        system_prompt: route.agent.system_prompt,
        read_only: Boolean(route.agent.read_only),
        reasoning: route.agent.reasoning?.[route.task] || null,
        max_tokens: route.maxTokens || config.defaults?.max_tokens,        context_window: entry?.context_window,
        pricing: entry?.pricing,
        prompt: config.prompts?.[route.task] || null,
      },
      null,
      2,
    ) + '\n',
  );
  return 0;
}

// ------------------------------------------------------------------ main ---

async function main() {
  const argv = process.argv.slice(2);
  const command = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'run';
  const args = parseArgs(argv[0] && !argv[0].startsWith('--') ? argv.slice(1) : argv);

  switch (command) {
    case 'run':
      process.exit(await cmdRun(args));
      break;
    case 'chat':
    case 'interactive':
      process.exit(await cmdInteractive(args));
      break;
    case 'self-test':
      process.exit(await cmdSelfTest(args));
      break;
    case 'models':
      process.exit(await cmdModels(args));
      break;
    case 'show':
      process.exit(cmdShow(args));
      break;
    case 'help':
    case '--help':
      process.stdout.write(
        [
          'swr-agent — MiniMax bridge for the SWR Software Factory',
          '',
          '  run    --agent <name> [--task <task>] [--model <id>] [--prompt <text>]',
          '         [--context <text> | --context-file <path>] [--files a,b]',
          '         [--diff <text>] [--allow-writes] [--json] [--dry-run]',
          '         [--max-tokens <n>] [--effort low|medium|high|xhigh|max]',
          '  chat    --agent <name> [--task <task>]   interactive session (same tools, same rules)',
          '  models          list the live model catalog from MiniMax',
          '  show    --agent <name> [--task <task>]    print the resolved route',
          '',
          `  Env: ${loadConfig().provider.api_key_env} (required), MINIMAX_BASE_URL (optional)`,
          '',
        ].join('\n'),
      );
      process.exit(0);
      break;
    default:
      fail(2, `unknown command "${command}". Try: run | models | show | help`);
  }
}

main().catch((err) => {
  fail(1, err?.stack || err?.message || String(err));
});
