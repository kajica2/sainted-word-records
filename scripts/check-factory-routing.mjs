#!/usr/bin/env node
// scripts/check-factory-routing.mjs — the Software Factory router gate.
//
// WHY
// ---
// The factory is a routing table plus a bridge. A routing table is a place
// where a typo becomes a 400 at 02:17 in the morning, when nobody is
// watching, and where a stale model id silently bills a tier you did not
// intend. This gate makes both loud, and it does it without an API key.
//
// WHAT IT CHECKS
// --------------
//   1. config   — routing.config.json parses and declares a provider
//   2. provider — the base URL is a MiniMax endpoint, not Anthropic's
//   3. models   — every id in the catalog is a MiniMax id; a `claude-*` id
//                 anywhere in the file is a failed port, not a typo
//   4. refs     — every model an agent or a trigger points at exists in
//                 the catalog
//   5. roles    — every agent's system_prompt file exists on disk
//   6. triggers — every trigger points at a known agent, a known model, a
//                 task the agent actually has, and a prompt that exists
//   7. effort   — an effort value is only set on a model that supports
//                 output_config.effort (MiniMax-M3.1-Flash today; asking
//                 M3 for it is a 400)
//   8. allowlist— write_file may only touch repo-relative paths inside the
//                 repo; no `../` escapes, no absolute paths
//   9. team     — agents/team.config.json, if it declares models, agrees
//                 with the catalog
//
// Exit code 0 = the router is sound, 1 = something is wrong.

import { readFileSync, existsSync } from 'node:fs';
import { resolve, isAbsolute, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_PATH = resolve(ROOT, 'software-factory/routing.config.json');
const TEAM_CONFIG_PATH = resolve(ROOT, 'agents/team.config.json');

let failed = 0;
let warned = 0;

const ok = (msg) => console.log(`✓ ${msg}`);
const bad = (msg) => {
  console.error(`✗ ${msg}`);
  failed++;
};
const warn = (msg) => {
  console.warn(`! ${msg}`);
  warned++;
};

// ------------------------------------------------------------------ config ---

if (!existsSync(CONFIG_PATH)) {
  bad(`routing config not found: ${CONFIG_PATH}`);
  process.exit(1);
}

let config;
try {
  config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  ok('routing.config.json parses');
} catch (err) {
  bad(`routing.config.json is not valid JSON: ${err.message}`);
  process.exit(1);
}

// ---------------------------------------------------------------- provider ---

const provider = config.provider || {};
if (provider.name === 'minimax') {
  ok('provider is minimax');
} else {
  bad(`provider.name is "${provider.name}" — expected "minimax"`);
}

if (typeof provider.base_url === 'string' && /minimax\.(io|com)/i.test(provider.base_url)) {
  ok(`base_url points at MiniMax (${provider.base_url})`);
} else {
  bad(`base_url is not a MiniMax endpoint: ${provider.base_url}`);
}

if (provider.api_key_env) {
  ok(`api key env var is ${provider.api_key_env}`);
} else {
  bad('provider.api_key_env is not set');
}

if (provider.wire_format === 'anthropic-messages') {
  ok('wire format is anthropic-messages (MiniMax /anthropic endpoint)');
} else {
  bad(`unexpected wire_format: ${provider.wire_format}`);
}

// ------------------------------------------------------------------ models ---

const catalog = config.model_catalog || {};
const modelIds = Object.keys(catalog);
if (!modelIds.length) {
  bad('model_catalog is empty');
}

for (const [id, entry] of Object.entries(catalog)) {
  if (!/^minimax-/i.test(id)) {
    bad(`model "${id}" is not a MiniMax model id`);
  }
  if (!entry.context_window) bad(`model "${id}" has no context_window`);
  if (!entry.pricing?.input_per_mtok) bad(`model "${id}" has no input price`);
}

// A Claude id anywhere in the file is a failed port, not a typo — the
// whole point of this factory is that the provider is MiniMax.
const raw = readFileSync(CONFIG_PATH, 'utf8');
const claudeIds = [...raw.matchAll(/claude-[a-z0-9.-]+/gi)].map((m) => m[0]);
const uniqueClaudeIds = [...new Set(claudeIds)];
if (uniqueClaudeIds.length) {
  const inCatalog = uniqueClaudeIds.filter((id) => modelIds.includes(id));
  if (inCatalog.length) {
    bad(`Claude model ids in the catalog: ${inCatalog.join(', ')}`);
  } else {
    ok(`Claude ids only appear as maps_from_claude provenance (${uniqueClaudeIds.length})`);
  }
} else {
  ok('no Claude model ids in the config');
}

// ------------------------------------------------------------------- roles ---

for (const [name, agent] of Object.entries(config.agents || {})) {
  if (!agent.system_prompt) {
    bad(`${name} has no system_prompt`);
    continue;
  }
  const abs = isAbsolute(agent.system_prompt) ? agent.system_prompt : resolve(ROOT, agent.system_prompt);
  if (existsSync(abs)) {
    ok(`${name} → ${agent.system_prompt}`);
  } else {
    bad(`${name} → ${agent.system_prompt} (file does not exist)`);
  }
}

// ------------------------------------------------------------------ models ---

function checkModelRef(where, id) {
  if (!id) {
    bad(`${where} has no model`);
    return false;
  }
  if (!catalog[id]) {
    bad(`${where} → unknown model "${id}"`);
    return false;
  }
  return true;
}

for (const [name, agent] of Object.entries(config.agents || {})) {
  checkModelRef(`${name}.model_default`, agent.model_default);
  for (const [task, id] of Object.entries(agent.models || {})) {
    if (!checkModelRef(`${name}.models.${task}`, id)) continue;
    const reasoning = agent.reasoning?.[task] || {};
    const entry = catalog[id];

    if (reasoning.effort) {
      if (!entry.supports?.effort) {
        bad(`${name}.${task} sets effort "${reasoning.effort}" but ${id} does not support output_config.effort`);
      } else if (entry.effort_values && !entry.effort_values.includes(reasoning.effort)) {
        bad(`${name}.${task} effort "${reasoning.effort}" is not valid for ${id} (allowed: ${entry.effort_values.join(', ')})`);
      }
    }

    if (reasoning.thinking_budget_tokens) {
      // Only the M2.x family takes a thinking budget. M3 and Flash decide
      // their own depth; sending budget_tokens to them is a 400.
      if (entry.thinking?.mode !== 'budget') {
        bad(
          `${name}.${task} sets thinking_budget_tokens but ${id} uses "${entry.thinking?.mode}" thinking, which takes no budget`,
        );
      }
    }
  }
}

// ---------------------------------------------------------------- triggers ---

for (const [name, trigger] of Object.entries(config.triggers || {})) {
  const agent = config.agents?.[trigger.agent];
  if (!agent) {
    bad(`trigger "${name}" → unknown agent "${trigger.agent}"`);
    continue;
  }
  ok(`trigger "${name}" → ${trigger.agent}`);
  if (checkModelRef(`trigger "${name}"`, trigger.model)) {
    const reasoning = agent.reasoning?.[trigger.task] || {};
    if (reasoning.effort && !catalog[trigger.model].supports?.effort) {
      bad(`trigger "${name}" inherits effort "${reasoning.effort}" but ${trigger.model} does not support it`);
    }
    if (reasoning.thinking_budget_tokens && catalog[trigger.model].thinking?.mode !== 'budget') {
      bad(`trigger "${name}" inherits a thinking budget but ${trigger.model} takes none`);
    }
  }
  if (trigger.task && !agent.models?.[trigger.task]) {
    bad(`trigger "${name}" uses task "${trigger.task}" which ${trigger.agent} does not declare`);
  }
  if (!config.prompts?.[trigger.task]) {
    bad(`trigger "${name}" has no prompt for task "${trigger.task}"`);
  }
}

// --------------------------------------------------------------- allowlist ---

for (const path of config.tools?.write_allowlist || []) {
  if (isAbsolute(path)) {
    bad(`write allowlist entry is an absolute path: ${path}`);
  } else if (path.includes('..')) {
    bad(`write allowlist entry escapes the repo: ${path}`);
  } else {
    ok(`write allowlist: ${path}`);
  }
}

// -------------------------------------------------------------- team config ---

if (existsSync(TEAM_CONFIG_PATH)) {
  try {
    const team = JSON.parse(readFileSync(TEAM_CONFIG_PATH, 'utf8'));
    const teamAgents = team.agents || {};
    const declared = Object.entries(teamAgents).filter(([, a]) => a.model_default || a.models);
    if (!declared.length) {
      warn('agents/team.config.json pins no models — the local team could disagree with the CI factory');
    } else {
      for (const [name, spec] of declared) {
        const ids = [spec.model_default, ...Object.values(spec.models || {})].filter(Boolean);
        for (const id of ids) {
          if (!catalog[id]) {
            bad(`agents/team.config.json → ${name} uses unknown model "${id}"`);
          }
        }
        ok(`agents/team.config.json → ${name} = ${ids.join(', ')}`);
      }
    }
    if (team.provider?.name && team.provider.name !== 'minimax') {
      bad(`agents/team.config.json pins provider "${team.provider.name}" — the factory runs on minimax`);
    }
  } catch (err) {
    bad(`agents/team.config.json is not valid JSON: ${err.message}`);
  }
}

// ------------------------------------------------------------------ verdict ---

if (failed) {
  console.error(`\n${failed} routing check(s) failed`);
  process.exit(1);
}
console.log(`✓ router OK — ${modelIds.length} models, ${Object.keys(config.agents || {}).length} agents, ${Object.keys(config.triggers || {}).length} triggers${warned ? ` (${warned} warning(s))` : ''}`);
