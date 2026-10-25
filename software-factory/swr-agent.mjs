#!/usr/bin/env node
// software-factory/swr-agent.mjs
//
// The bridge between the factory and whatever model is doing the work.
//
// The factory is multi-provider: MiniMax and OpenCode Zen speak the
// Anthropic Messages API, xAI speaks the OpenAI Responses API, Google
// Antigravity speaks the Interactions API, and the local agent CLIs
// (agy, opencode) speak stdout. providers.mjs owns the dialects; this
// file owns the routing, the tools and the guards.
//
// ZERO DEPENDENCIES ON PURPOSE
// ----------------------------
// The factory runs in CI on a bare `npm ci` of a repo with no LLM SDK in
// its tree. A global fetch (Node 18+) is the whole transport.
//
// MODEL IDS ARE PROVIDER-QUALIFIED
// -------------------------------
// `minimax/MiniMax-M3`, `xai/grok-4.7`, `opencode/claude-sonnet-5`,
// `antigravity/gemini-3.8-flash`. The same convention OpenCode uses for
// its own config. A bare id is also accepted and resolved by search, but
// the qualified form is what the router stores — "MiniMax-M3" alone does
// not say who bills for it.
//
// USAGE
//   node software-factory/swr-agent.mjs run --agent SWR-Ops --task triage
//   node software-factory/swr-agent.mjs run --agent SWR-Check --task verification \
//        --diff-file pr.diff --json
//   node software-factory/swr-agent.mjs run --agent SWR-Ops --task planning \
//        --model xai/grok-4.7 --context-file drift.txt --allow-writes
//   node software-factory/swr-agent.mjs chat --agent SWR-Twin --task creative
//   node software-factory/swr-agent.mjs show --agent SWR-Ops
//   node software-factory/swr-agent.mjs models --live
//   node software-factory/swr-agent.mjs formats
//   node software-factory/swr-agent.mjs self-test
//
// EXIT CODES
//   0  success
//   1  runtime / API error
//   2  usage or configuration error

import { readFileSync, existsSync, appendFileSync, writeFileSync, statSync } from 'node:fs';
import { resolve, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface as readline } from 'node:readline';
import { spawn } from 'node:child_process';
import { FORMATS } from './providers.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const CONFIG_PATH = resolve(HERE, 'routing.config.json');

// ---------------------------------------------------------------- config ---

function loadConfig() {
  if (!existsSync(CONFIG_PATH)) fail(2, `routing config not found at ${CONFIG_PATH}`);
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
    if (next === undefined || next.startsWith('--')) args[key] = true;
    else {
      args[key] = next;
      i++;
    }
  }
  return args;
}

// --------------------------------------------------------------- routing ---

// A model ref is "provider/model". A bare "model" is resolved by searching
// every provider in the registry, first match wins.
function resolveModelRef(config, ref) {
  if (!ref) fail(2, 'no model given');
  const models = config.models || {};

  if (ref.includes('/')) {
    const [providerName, ...rest] = ref.split('/');
    const modelId = rest.join('/');
    const provider = config.providers?.[providerName];
    if (!provider) {
      fail(2, `unknown provider "${providerName}" in "${ref}". Known: ${Object.keys(config.providers || {}).join(', ')}`);
    }
    const spec = models[ref];
    if (!spec) fail(2, `model "${ref}" is not in the catalog`);
    return { ref, providerName, provider, modelId, spec };
  }

  const hits = Object.keys(models).filter((key) => key.split('/').slice(1).join('/') === ref);
  if (!hits.length) {
    const hint = /^claude-/i.test(ref)
      ? ' A bare Claude id needs a provider — try opencode/claude-sonnet-5.'
      : '';
    fail(2, `model "${ref}" is not in the catalog.${hint} Catalog: ${Object.keys(models).join(', ')}`);
  }
  if (hits.length > 1) {
    process.stderr.write(`swr-agent: "${ref}" is ambiguous — using ${hits[0]} of ${hits.join(', ')}\n`);
  }
  const key = hits[0];
  const providerName = key.split('/')[0];
  return { ref: key, providerName, provider: config.providers[providerName], modelId: key.split('/').slice(1).join('/'), spec: models[key] };
}

// The chain of models a task may run on, in order. The first one that
// answers wins; the rest are the fallback when a provider is down, rate
// limited, or simply not configured.
function resolveTask(config, agentName, taskName) {
  const agent = config.agents?.[agentName];
  if (!agent) {
    fail(2, `unknown agent "${agentName}". Known: ${Object.keys(config.agents || {}).join(', ')}`);
  }
  if (!taskName) {
    return { agent, task: null, chain: [agent.model_default].filter(Boolean), effort: null, maxTokens: null };
  }

  const trigger = config.triggers?.[taskName];
  if (trigger) {
    if (trigger.agent !== agentName) {
      fail(2, `trigger "${taskName}" belongs to ${trigger.agent}, not ${agentName}`);
    }
    const spec = agent.tasks?.[trigger.task];
    if (!spec) fail(2, `${agentName} has no task "${trigger.task}"`);
    return {
      agent,
      task: trigger.task,
      trigger,
      chain: [spec.primary, ...(spec.fallbacks || [])],
      effort: spec.effort || null,
      maxTokens: spec.max_tokens || null,
    };
  }

  const spec = agent.tasks?.[taskName];
  if (!spec) {
    fail(2, `${agentName} has no task "${taskName}". Tasks: ${Object.keys(agent.tasks || {}).join(', ')}`);
  }
  return {
    agent,
    task: taskName,
    trigger: null,
    chain: [spec.primary, ...(spec.fallbacks || [])],
    effort: spec.effort || null,
    maxTokens: spec.max_tokens || null,
  };
}

function resolveSystemPrompt(agent) {
  const path = agent.system_prompt;
  if (!path) return '';
  const abs = isAbsolute(path) ? path : resolve(REPO_ROOT, path);
  if (!existsSync(abs)) fail(2, `system prompt file not found for ${agent.role}: ${path}`);
  return readFileSync(abs, 'utf8');
}

// ------------------------------------------------------------------ auth ---

function providerBaseUrl(provider) {
  if (provider.base_url_env && process.env[provider.base_url_env]) {
    return process.env[provider.base_url_env];
  }
  return provider.base_url;
}

// Returns { headers, missing }. `missing` names the env var that is not
// set — a provider without a key is skipped, not an error, because a
// factory with one key is still a working factory.
function providerAuth(provider) {
  const auth = provider.auth || {};
  if (!auth.env) return { headers: {}, missing: null };
  const key = process.env[auth.env];
  if (!key) return { headers: {}, missing: auth.env };
  if (auth.type === 'bearer') return { headers: { Authorization: `Bearer ${key}` }, missing: null };
  if (auth.type === 'header') return { headers: { [auth.header]: key }, missing: null };
  return { headers: {}, missing: null };
}

// ------------------------------------------------------------------ cost ---

function estimateCost(modelRef, usage) {
  const spec = loadConfig().models?.[modelRef];
  if (!spec || !usage) return null;
  const p = spec.pricing || {};
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

function readRoots() {
  return { repo: REPO_ROOT, twin: resolve(REPO_ROOT, '..', 'digital_twin') };
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
  if (!abs.startsWith(base + '/') && abs !== base) {
    return { ok: false, message: `Path escapes the ${rootName} root: ${path}` };
  }
  if (!existsSync(abs)) return { ok: false, message: `Not found in the ${rootName} root: ${path}` };
  try {
    if (statSync(abs).isDirectory()) {
      return { ok: false, message: `${path} is a directory. Read a file inside it.` };
    }
    const content = readFileSync(abs, 'utf8');
    const capped = content.length > 120000 ? `${content.slice(0, 120000)}\n… [truncated]` : content;
    return { ok: true, message: capped };
  } catch (err) {
    return { ok: false, message: `Read failed for ${path}: ${err.message}` };
  }
}

function executeTool(config, agent, input, { allowWrites, dryRun }) {
  const allowlist = config.tools?.write_allowlist || [];
  const path = String(input?.path || '');
  const content = String(input?.content ?? '');
  const mode = input?.mode === 'overwrite' ? 'overwrite' : 'append';

  if (agent.read_only) return { ok: false, message: `${agent.role} is read-only and cannot write files.` };
  if (!allowlist.includes(path)) {
    return { ok: false, message: `Path not on the write allowlist: ${path}. Allowed: ${allowlist.join(', ')}` };
  }
  if (!allowWrites) {
    return { ok: false, message: `Writes are disabled. Re-run with ${config.tools?.write_requires_flag || '--allow-writes'} to permit them.` };
  }
  if (dryRun) return { ok: true, message: `[dry-run] would ${mode} ${path} (${content.length} bytes)` };
  try {
    if (mode === 'overwrite') writeFileSync(resolve(REPO_ROOT, path), content, 'utf8');
    else appendFileSync(resolve(REPO_ROOT, path), content, 'utf8');
    return { ok: true, message: `${mode === 'overwrite' ? 'Wrote' : 'Appended to'} ${path} (${content.length} bytes)` };
  } catch (err) {
    return { ok: false, message: `Write failed for ${path}: ${err.message}` };
  }
}

// -------------------------------------------------------------- transport ---

// Effort only exists on some models. Where it does not, the request goes
// out without it rather than failing — a fallback that cannot honour the
// effort is still a working fallback.
function effortFor(spec, effort) {
  const style = spec.reasoning?.style;
  if (!effort) return null;
  if (style === 'anthropic-effort' || style === 'openai-effort') {
    const values = spec.reasoning?.values;
    if (values && !values.includes(effort)) return null;
    return effort;
  }
  return null;
}

// Resolve a model ref to its provider, spec and wire format. The format
// decides which tools the model can be offered, so it gets resolved before
// the request is built rather than after.
function resolveFormat(config, modelRef) {
  const resolved = resolveModelRef(config, modelRef);
  const format = FORMATS[resolved.spec.format];
  if (!format) {
    fail(2, `model "${modelRef}" uses wire format "${resolved.spec.format}", which the bridge does not implement`);
  }
  return { resolved, format };
}

function buildTurn(config, { modelRef, agent, system, messages, tools, maxTokens, effort }) {
  const { resolved, format } = resolveFormat(config, modelRef);
  const effectiveEffort = effortFor(resolved.spec, effort);
  const built = format.build({
    provider: { ...resolved.provider, base_url: providerBaseUrl(resolved.provider) },
    model: resolved.modelId,
    system,
    messages,
    tools,
    maxTokens: maxTokens || config.defaults?.max_tokens || 16384,
    reasoning: resolved.spec.reasoning,
    effort: effectiveEffort,
  });
  return { resolved, format, built, effort: effectiveEffort };
}

async function httpCall(config, resolved, built, { timeoutMs, retries }) {
  const { headers: authHeaders, missing } = providerAuth(resolved.provider);
  if (missing) {
    return { skipped: true, reason: `${resolved.providerName} has no API key (${missing} is not set)` };
  }
  const headers = { 'Content-Type': 'application/json', ...(resolved.provider.headers || {}), ...authHeaders };
  const url = built.url;
  const retryOn = config.defaults?.retry_on || [429, 500, 502, 503, 504];

  let lastError = null;
  for (let attempt = 0; attempt <= (retries ?? 0); attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs || 600000);
    try {
      const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(built.body), signal: controller.signal });
      clearTimeout(timer);
      const text = await res.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        return { error: `HTTP ${res.status} with a non-JSON body: ${text.slice(0, 300)}` };
      }
      if (!res.ok) {
        const baseResp = json?.base_resp;
        const detail = baseResp
          ? `status_code=${baseResp.status_code} status_msg=${baseResp.status_msg || ''}`
          : json?.error?.message || json?.message || text.slice(0, 300);
        lastError = `HTTP ${res.status} from ${resolved.providerName}: ${detail}`;
        if (retryOn.includes(res.status) && attempt < (retries ?? 0)) {
          const backoff = 1000 * 4 ** attempt;
          process.stderr.write(`swr-agent: ${lastError} — retrying in ${backoff}ms\n`);
          await new Promise((r) => setTimeout(r, backoff));
          continue;
        }
        return { error: lastError, retryable: retryOn.includes(res.status) };
      }
      return { json };
    } catch (err) {
      clearTimeout(timer);
      if (err?.name === 'AbortError') return { error: `${resolved.providerName} timed out after ${timeoutMs}ms`, retryable: true };
      lastError = err.message;
      if (attempt < (retries ?? 0)) {
        const backoff = 1000 * 4 ** attempt;
        process.stderr.write(`swr-agent: ${lastError} — retrying in ${backoff}ms\n`);
        await new Promise((r) => setTimeout(r, backoff));
        continue;
      }
      return { error: `${resolved.providerName} request failed: ${lastError}`, retryable: true };
    }
  }
  return { error: lastError, retryable: true };
}

async function cliCall(resolved, built, { timeoutMs }) {
  const command = built.command;
  if (!command) return { error: `${resolved.providerName} has no command configured` };
  return new Promise((resolvePromise) => {
    const child = spawn(command, built.args, { cwd: REPO_ROOT, env: process.env });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      resolvePromise({ error: `${command} timed out after ${timeoutMs}ms`, retryable: true });
    }, timeoutMs || 600000);
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('error', (err) => {
      clearTimeout(timer);
      resolvePromise({ error: `could not run ${command}: ${err.message}`, retryable: false });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        resolvePromise({ error: `${command} exited with ${code}: ${stderr.slice(0, 300)}`, retryable: true });
        return;
      }
      resolvePromise({ stdout, stderr });
    });
    if (built.stdin) {
      child.stdin.write(built.stdin);
      child.stdin.end();
    }
  });
}

// ------------------------------------------------------------------ turn ---

// One turn against one model: build, send, parse. Returns the neutral
// shape every format is normalised into.
async function runTurn(config, { modelRef, agent, system, messages, tools, maxTokens, effort, transport }) {
  const { resolved, format, built, effort: effectiveEffort } = buildTurn(config, {
    modelRef,
    agent,
    system,
    messages,
    tools,
    maxTokens,
    effort,
  });

  if (format === FORMATS.cli) {
    const res = await cliCall(resolved, built, transport);
    if (res.error) return { error: res.error, retryable: res.retryable, modelRef, provider: resolved.providerName };
    const parsed = format.parse(res.stdout);
    return { modelRef, provider: resolved.providerName, format: resolved.spec.format, effort: effectiveEffort, ...parsed, usage: parsed.usage };
  }

  const res = await httpCall(config, resolved, built, transport);
  if (res.skipped) return { skipped: true, reason: res.reason, modelRef, provider: resolved.providerName };
  if (res.error) return { error: res.error, retryable: res.retryable, modelRef, provider: resolved.providerName };
  const parsed = format.parse(res.json);
  return { modelRef, provider: resolved.providerName, format: resolved.spec.format, effort: effectiveEffort, ...parsed, raw: res.json };
}

// Run a turn against the chain until one of them answers.
async function runTurnWithFailover(config, chain, ctx) {
  const attempts = [];
  for (const modelRef of chain) {
    const result = await runTurn(config, { ...ctx, modelRef });
    if (result.skipped) {
      attempts.push({ model: modelRef, skipped: result.reason });
      process.stderr.write(`swr-agent: skipping ${modelRef} — ${result.reason}\n`);
      continue;
    }
    if (result.error) {
      attempts.push({ model: modelRef, error: result.error });
      process.stderr.write(`swr-agent: ${modelRef} failed — ${result.error}\n`);
      continue;
    }
    attempts.push({ model: modelRef, ok: true });
    return { result, attempts };
  }
  return { result: null, attempts };
}

// ------------------------------------------------------------- tool loop ---

function toolDefsFor(config, agent, format) {
  if (!format.supportsTools) return [];
  const defs = [{ name: 'read_file', description: readToolSchema().description, parameters: readToolSchema().input_schema }];
  if (!agent.read_only) {
    defs.push({ name: 'write_file', description: writeToolSchema().description, parameters: writeToolSchema().input_schema });
  }
  return defs;
}

function runToolCalls(config, agent, response, toolCalls, { allowWrites, toolLog = [] }) {
  const results = [];
  for (const call of toolCalls) {
    let result;
    if (call.name === 'read_file') result = executeRead(config, call.input);
    else if (call.name === 'write_file') result = executeTool(config, agent, call.input, { allowWrites, dryRun: false });
    else result = { ok: false, message: `Unknown tool: ${call.name}` };
    toolLog.push({ name: call.name, input: call.input, ok: result.ok, message: result.message });
    results.push({ type: 'tool_result', tool_use_id: call.id, content: result.ok ? result.message : `ERROR: ${result.message}`, is_error: !result.ok });
  }
  return results;
}

// -------------------------------------------------------------- user text ---

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
    for (const f of String(args.files).split(',').map((s) => s.trim()).filter(Boolean)) {
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

// -------------------------------------------------------------- commands ---

async function cmdRun(args) {
  const config = loadConfig();
  const route = resolveTask(config, args.agent, args.task);
  const chain = args.model ? [args.model] : route.chain;
  const userText = assembleUserText(config, args, route);
  const system = resolveSystemPrompt(route.agent);
  const dryRun = Boolean(args['dry-run']);

  const transport = {
    timeoutMs: Number(args.timeout) || config.defaults?.timeout_ms,
    retries: config.defaults?.retries,
  };

  if (dryRun) {
    const previews = [];
    for (const modelRef of chain) {
      const { resolved, format } = resolveFormat(config, modelRef);
      const tools = toolDefsFor(config, route.agent, format);
      const { built, effort } = buildTurn(config, {
        modelRef,
        agent: route.agent,
        system,
        messages: [{ role: 'user', content: [{ type: 'text', text: userText }] }],
        tools,
        maxTokens: args['max-tokens'] ? Number(args['max-tokens']) : route.maxTokens,
        effort: route.effort,
      });
      const { missing } = providerAuth(resolved.provider);
      previews.push({
        model: modelRef,
        provider: resolved.providerName,
        format: resolved.spec.format,
        effort,
        api_key_env: resolved.provider.auth?.env || null,
        api_key_present: resolved.provider.auth?.env ? !missing : true,
        url: built.url,
        body: built.body,
        tools: tools.map((t) => t.name),
      });
    }
    process.stdout.write(JSON.stringify({ dryRun: true, chain: previews }, null, 2) + '\n');
    return 0;
  }

  const toolLog = [];
  let payload = null;
  const attempts = [];

  for (let turn = 0; turn < 3; turn++) {
    const messages = [{ role: 'user', content: [{ type: 'text', text: userText }] }];
    const ctx = {
      agent: route.agent,
      system,
      messages,
      maxTokens: args['max-tokens'] ? Number(args['max-tokens']) : route.maxTokens,
      effort: route.effort,
      transport,
    };

    // The first turn decides the tools; later turns reuse the same format.
    const probe = resolveFormat(config, chain[0]);
    const tools = toolDefsFor(config, route.agent, probe.format);

    const { result, attempts: chainAttempts } = await runTurnWithFailover(config, chain, { ...ctx, tools });
    attempts.push(...chainAttempts);
    if (!result) {
      const why = chainAttempts.map((a) => `${a.model}: ${a.error || a.skipped}`).join(' | ');
      fail(1, `every model in the chain failed — ${why}`);
    }

    if (result.thinking && args.verbose) process.stderr.write(`[thinking]\n${result.thinking}\n`);

    if (!result.toolCalls?.length) {
      payload = {
        model: result.modelRef,
        provider: result.provider,
        format: result.format,
        effort: result.effort,
        stop_reason: result.stopReason,
        text: result.text,
        thinking: args.verbose ? result.thinking : undefined,
        usage: result.usage,
        cost: estimateCost(result.modelRef, result.usage),
        tool_calls: toolLog,
        attempts,
      };
      break;
    }

    const results = runToolCalls(config, route.agent, result, result.toolCalls, {
      allowWrites: Boolean(args['allow-writes']),
      toolLog,
    });
    // Feed the tool results back and ask again — on the same model that
    // asked for them, so the plan survives the round trip.
    messages.push({ role: 'assistant', content: result.toolCalls.map((c) => ({ type: 'tool_use', id: c.id, name: c.name, input: c.input })) });
    messages.push({ role: 'tool', content: results });
  }

  if (!payload) {
    payload = { model: chain[0], text: '', usage: null, cost: null, tool_calls: toolLog, attempts };
  }

  if (args.json) {
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
  } else {
    if (payload.text) process.stdout.write(payload.text + '\n');
    if (payload.cost) {
      process.stderr.write(
        `\n[swr-agent] ${payload.provider}/${payload.model} · in ${payload.cost.input_tokens} / out ${payload.cost.output_tokens} tokens · $${payload.cost.usd}\n`,
      );
    }
    for (const call of payload.tool_calls || []) {
      process.stderr.write(`[tool] ${call.name} → ${call.ok ? 'ok' : 'refused'}: ${call.message}\n`);
    }
  }
  return 0;
}

async function cmdChat(args) {
  const config = loadConfig();
  const route = resolveTask(config, args.agent, args.task);
  const chain = args.model ? [args.model] : route.chain;
  const system = resolveSystemPrompt(route.agent);
  const transport = { timeoutMs: Number(args.timeout) || config.defaults?.timeout_ms, retries: config.defaults?.retries };

  const banner = `▌ ${args.agent} · ${chain[0]}${route.agent.read_only ? ' · read-only' : ''}`;
  process.stderr.write(`${banner}\n  /exit to quit\n`);

  const history = [];
  const seed = args.prompt || config.prompts?.[route.task] || 'You are online. Introduce yourself in two sentences, then wait for instructions.';
  history.push({ role: 'user', content: [{ type: 'text', text: seed }] });

  const probe = resolveFormat(config, chain[0]);
  const tools = toolDefsFor(config, route.agent, probe.format);

  const first = await runTurnWithFailover(config, chain, { agent: route.agent, system, messages: history, tools, maxTokens: route.maxTokens, effort: route.effort, transport });
  if (!first.result) fail(1, 'every model in the chain failed on the opening turn');
  if (first.result.text) process.stdout.write(`${first.result.text}\n`);
  history.push({ role: 'assistant', content: [{ type: 'text', text: first.result.text }] });

  const rl = readline({ input: process.stdin, output: process.stdout, prompt: '> ' });
  rl.prompt();
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) {
      rl.prompt();
      continue;
    }
    if (trimmed === '/exit' || trimmed === '/quit') break;

    history.push({ role: 'user', content: [{ type: 'text', text: trimmed }] });
    for (let turn = 0; turn < 3; turn++) {
      const { result } = await runTurnWithFailover(config, chain, { agent: route.agent, system, messages: history, tools, maxTokens: route.maxTokens, effort: route.effort, transport });
      if (!result) break;
      if (result.thinking && args.verbose) process.stderr.write(`[thinking]\n${result.thinking}\n`);
      if (result.text) process.stdout.write(`${result.text}\n`);
      if (!result.toolCalls?.length) {
        history.push({ role: 'assistant', content: [{ type: 'text', text: result.text }] });
        break;
      }
      const results = runToolCalls(config, route.agent, result, result.toolCalls, { allowWrites: Boolean(args['allow-writes']) });
      history.push({ role: 'assistant', content: result.toolCalls.map((c) => ({ type: 'tool_use', id: c.id, name: c.name, input: c.input })) });
      history.push({ role: 'tool', content: results });
    }
    rl.prompt();
  }
  rl.close();
  return 0;
}

function cmdShow(args) {
  const config = loadConfig();
  const route = resolveTask(config, args.agent, args.task);
  const chain = route.chain.map((ref) => {
    const spec = config.models?.[ref] || {};
    const provider = config.providers?.[spec.provider] || {};
    const { missing } = providerAuth(provider);
    return {
      model: ref,
      provider: spec.provider,
      format: spec.format,
      context_window: spec.context_window,
      reasoning: spec.reasoning,
      pricing: spec.pricing,
      api_key_env: provider.auth?.env || null,
      api_key_present: provider.auth?.env ? !missing : true,
    };
  });
  process.stdout.write(
    JSON.stringify(
      {
        agent: args.agent,
        role: route.agent.role,
        task: route.task,
        system_prompt: route.agent.system_prompt,
        read_only: Boolean(route.agent.read_only),
        effort: route.effort,
        max_tokens: route.maxTokens,
        chain,
        prompt: config.prompts?.[route.task] || null,
      },
      null,
      2,
    ) + '\n',
  );
  return 0;
}

async function cmdModels(args) {
  const config = loadConfig();
  const rows = Object.entries(config.models).map(([ref, spec]) => {
    const provider = config.providers?.[spec.provider] || {};
    const { missing } = providerAuth(provider);
    return {
      model: ref,
      provider: spec.provider,
      format: spec.format,
      context_window: spec.context_window,
      pricing: spec.pricing,
      api_key_env: provider.auth?.env || null,
      api_key_present: provider.auth?.env ? !missing : true,
    };
  });
  const out = { configured: rows };

  if (args.live) {
    out.live = {};
    for (const [name, provider] of Object.entries(config.providers || {})) {
      if (!provider.models_path) {
        out.live[name] = { skipped: 'no models endpoint' };
        continue;
      }
      const { headers, missing } = providerAuth(provider);
      if (missing) {
        out.live[name] = { skipped: `${missing} is not set` };
        continue;
      }
      try {
        const url = `${providerBaseUrl(provider).replace(/\/+$/, '')}${provider.models_path}`;
        const res = await fetch(url, { headers: { ...(provider.headers || {}), ...headers } });
        const text = await res.text();
        if (!res.ok) {
          out.live[name] = { error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
          continue;
        }
        const json = JSON.parse(text);
        const ids = (json.data || json.models || []).map((m) => m.id || m.name).filter(Boolean);
        out.live[name] = { url, count: ids.length, missing_from_config: ids.filter((id) => !Object.keys(config.models).some((k) => k === `${name}/${id}`)) };
      } catch (err) {
        out.live[name] = { error: err.message };
      }
    }
  }
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  return 0;
}

function cmdFormats() {
  process.stdout.write(
    JSON.stringify(
      Object.fromEntries(
        Object.entries(FORMATS).map(([name, f]) => [name, { label: f.label, toolLoop: f.toolLoop, supportsTools: f.supportsTools }]),
      ),
      null,
      2,
    ) + '\n',
  );
  return 0;
}

// The guard rails, proven without an API key.
async function cmdSelfTest() {
  const config = loadConfig();
  let failed = 0;
  const ok = (msg) => process.stdout.write(`✓ ${msg}\n`);
  const bad = (msg) => {
    process.stderr.write(`✗ ${msg}\n`);
    failed++;
  };

  const agent = config.agents['SWR-Ops'];
  const check = config.agents['SWR-Check'];
  const allowed = (config.tools?.write_allowlist || [])[0];

  let r = executeTool(config, agent, { path: 'package.json', content: 'x' }, { allowWrites: true, dryRun: true });
  if (r.ok) bad('write_file allowed a path outside the allowlist');
  else ok(`write refused off-allowlist: ${r.message}`);

  r = executeTool(config, agent, { path: allowed, content: 'x' }, { allowWrites: false, dryRun: false });
  if (r.ok) bad('write_file wrote without --allow-writes');
  else ok(`write refused without the flag: ${r.message}`);

  r = executeTool(config, agent, { path: allowed, content: 'x' }, { allowWrites: true, dryRun: true });
  if (!r.ok) bad(`write refused on an allowlisted path with the flag: ${r.message}`);
  else ok(`write allowed on the allowlist with the flag: ${r.message}`);

  r = executeTool(config, check, { path: allowed, content: 'x' }, { allowWrites: true, dryRun: true });
  if (r.ok) bad('a read-only agent was allowed to write');
  else ok(`read-only agent refused: ${r.message}`);

  r = executeRead(config, { path: '../../../etc/passwd' });
  if (r.ok) bad('read_file escaped the repo root');
  else ok(`read refused outside the root: ${r.message}`);

  r = executeRead(config, { path: 'package.json' });
  if (!r.ok) bad(`read_file failed on a repo file: ${r.message}`);
  else ok('read works inside the root');

  // Every routed model must exist and speak a format the bridge implements.
  const routed = new Set();
  for (const a of Object.values(config.agents || {})) {
    for (const spec of Object.values(a.tasks || {})) {
      routed.add(spec.primary);
      for (const f of spec.fallbacks || []) routed.add(f);
    }
  }
  for (const ref of routed) {
    const spec = config.models?.[ref];
    if (!spec) {
      bad(`routed model "${ref}" is not in the catalog`);
      continue;
    }
    if (!FORMATS[spec.format]) {
      bad(`routed model "${ref}" uses unimplemented format "${spec.format}"`);
      continue;
    }
    if (!config.providers?.[spec.provider]) {
      bad(`routed model "${ref}" names unknown provider "${spec.provider}"`);
    }
  }
  ok(`${routed.size} routed models resolve to an implemented format`);

  // A Claude id has to be provider-qualified.
  const { spawnSync } = await import('node:child_process');
  const script = resolve(HERE, 'swr-agent.mjs');
  const res = spawnSync(process.execPath, [script, 'run', '--agent', 'SWR-Ops', '--task', 'planning', '--model', 'claude-3-opus-20240229', '--context', 'x'], { encoding: 'utf8' });
  if (res.status === 2 && /not in the catalog/.test(res.stderr)) {
    ok('an unqualified Claude model id is rejected');
  } else {
    bad(`expected the unqualified Claude id to be rejected (exit 2), got ${res.status}: ${res.stderr?.trim()}`);
  }

  if (failed) {
    process.stderr.write(`\n${failed} self-test(s) failed\n`);
    return 1;
  }
  process.stdout.write('✓ bridge self-test OK — the guards hold\n');
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
      process.exit(await cmdChat(args));
      break;
    case 'show':
      process.exit(cmdShow(args));
      break;
    case 'models':
      process.exit(await cmdModels(args));
      break;
    case 'formats':
      process.exit(cmdFormats());
      break;
    case 'self-test':
      process.exit(await cmdSelfTest(args));
      break;
    case 'help':
    case '--help':
      process.stdout.write(
        [
          'swr-agent — the SWR Software Factory bridge',
          '',
          '  run    --agent <name> [--task <task>] [--model provider/model] [--prompt <text>]',
          '         [--context <text> | --context-file <path>] [--files a,b]',
          '         [--diff <text> | --diff-file <path>] [--allow-writes] [--json]',
          '         [--dry-run] [--max-tokens <n>] [--effort low|medium|high|xhigh|max]',
          '  chat    --agent <name> [--task <task>]      interactive session',
          '  show    --agent <name> [--task <task>]      print the resolved chain',
          '  models  [--live]                            the model catalog',
          '  formats                                   the wire formats the bridge speaks',
          '  self-test                                 the guard rails (no API key)',
          '',
          '  Env: MINIMAX_API_KEY, OPENCODE_API_KEY, XAI_API_KEY, GEMINI_API_KEY',
          '       (a provider without a key is skipped, not an error)',
          '',
        ].join('\n'),
      );
      process.exit(0);
      break;
    default:
      fail(2, `unknown command "${command}". Try: run | chat | show | models | formats | self-test | help`);
  }
}

main().catch((err) => {
  fail(1, err?.stack || err?.message || String(err));
});
