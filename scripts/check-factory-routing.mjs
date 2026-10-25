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
//   1. config    — routing.config.json parses and declares providers
//   2. formats   — every provider and every model speaks a wire format the
//                  bridge actually implements (asked of the bridge itself,
//                  not a copy of its list)
//   3. models    — every id is provider-qualified; the provider exists;
//                  the catalog has no bare ids
//   4. routing   — every primary and fallback exists in the catalog
//   5. metadata  — a model that is actually routed has a context window, a
//                  price and a reasoning style. A catalog entry nobody
//                  routes to may leave the context window open.
//   6. effort    — an effort is only set on a model whose reasoning style
//                  accepts one. Where a fallback cannot honour it, the
//                  bridge drops it — that is a warning, not a failure.
//   7. roles     — every agent's system_prompt file exists on disk
//   8. triggers  — every trigger points at a known agent, a known task and
//                  a prompt that exists
//   9. allowlist — write_file may only touch repo-relative paths inside the
//                  repo; no `../` escapes, no absolute paths
//  10. team      — agents/team.config.json agrees with the catalog
//
// Exit code 0 = the router is sound, 1 = something is wrong.

import { readFileSync, existsSync } from 'node:fs';
import { resolve, isAbsolute, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_PATH = resolve(ROOT, 'software-factory/routing.config.json');
const TEAM_CONFIG_PATH = resolve(ROOT, 'agents/team.config.json');
const BRIDGE = resolve(ROOT, 'software-factory/swr-agent.mjs');

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

// ---------------------------------------------------------------- formats ---

// Ask the bridge which wire formats it implements. A hardcoded list here
// would drift from the code the moment someone adds a provider.
const implemented = new Set();
try {
  const out = execFileSync(process.execPath, [BRIDGE, 'formats'], { encoding: 'utf8' });
  for (const key of Object.keys(JSON.parse(out))) implemented.add(key);
  ok(`the bridge implements ${implemented.size} wire formats: ${[...implemented].join(', ')}`);
} catch (err) {
  bad(`could not ask the bridge for its formats: ${err.message}`);
}

const REASONING_STYLES = new Set([
  'anthropic-adaptive',
  'anthropic-budget',
  'anthropic-effort',
  'openai-effort',
  'none',
  'gemini-agent',
]);
const EFFORT_STYLES = new Set(['anthropic-effort', 'openai-effort']);

// --------------------------------------------------------------- providers ---

const providers = config.providers || {};
if (!Object.keys(providers).length) bad('no providers declared');
for (const [name, provider] of Object.entries(providers)) {
  if (provider.wire_format !== 'cli' && !provider.base_url) {
    bad(`provider "${name}" has no base_url`);
  }
  if (!provider.wire_format) {
    bad(`provider "${name}" has no wire_format`);
  } else if (provider.wire_format !== 'per-model' && !implemented.has(provider.wire_format)) {
    bad(`provider "${name}" uses wire format "${provider.wire_format}", which the bridge does not implement`);
  } else {
    ok(`provider "${name}" → ${provider.wire_format}`);
  }
  if (provider.wire_format === 'per-model' && !provider.messages_path) {
    bad(`provider "${name}" is per-model but declares no messages_path`);
  }
  const auth = provider.auth || {};
  if (provider.wire_format === 'cli') {
    if (!provider.command) bad(`provider "${name}" is a CLI but declares no command`);
    else ok(`provider "${name}" → ${provider.command}`);
  } else if (!auth.env) {
    bad(`provider "${name}" has no auth.env`);
  } else {
    ok(`provider "${name}" → ${auth.env}`);
  }
}

// ------------------------------------------------------------------ models ---

const models = config.models || {};
const modelIds = Object.keys(models);
if (!modelIds.length) bad('model catalog is empty');

for (const [ref, spec] of Object.entries(models)) {
  if (!ref.includes('/')) {
    bad(`model "${ref}" is not provider-qualified — use "provider/model"`);
    continue;
  }
  const providerName = ref.split('/')[0];
  const provider = providers[providerName];
  if (!provider) {
    bad(`model "${ref}" names unknown provider "${providerName}"`);
    continue;
  }
  if (spec.provider !== providerName) {
    bad(`model "${ref}" says provider "${spec.provider}" but its id says "${providerName}"`);
  }
  if (!implemented.has(spec.format)) {
    bad(`model "${ref}" uses wire format "${spec.format}", which the bridge does not implement`);
  }
  if (!REASONING_STYLES.has(spec.reasoning?.style)) {
    bad(`model "${ref}" has unknown reasoning style "${spec.reasoning?.style}"`);
  }
}

// ----------------------------------------------------------------- routing ---

const routed = new Map(); // ref -> { primary: bool, effort }

for (const [name, agent] of Object.entries(config.agents || {})) {
  if (!agent.system_prompt) {
    bad(`${name} has no system_prompt`);
  } else {
    const abs = isAbsolute(agent.system_prompt) ? agent.system_prompt : resolve(ROOT, agent.system_prompt);
    if (existsSync(abs)) ok(`${name} → ${agent.system_prompt}`);
    else bad(`${name} → ${agent.system_prompt} (file does not exist)`);
  }

  if (agent.model_default && !models[agent.model_default]) {
    bad(`${name}.model_default → unknown model "${agent.model_default}"`);
  }

  for (const [task, spec] of Object.entries(agent.tasks || {})) {
    const chain = [spec.primary, ...(spec.fallbacks || [])];
    for (const ref of chain) {
      const model = models[ref];
      if (!model) {
        bad(`${name}.${task} → unknown model "${ref}"`);
        continue;
      }
      const isPrimary = ref === spec.primary;
      if (!routed.has(ref)) routed.set(ref, { primary: false, effort: null });
      const entry = routed.get(ref);
      if (isPrimary) entry.primary = true;

      // A model that is actually routed needs real metadata.
      if (!model.context_window) bad(`${ref} is routed but has no context_window`);
      if (!model.pricing?.input_per_mtok && model.pricing?.input_per_mtok !== 0) {
        bad(`${ref} is routed but has no input price`);
      }

      // Effort only exists on some models.
      if (spec.effort) {
        if (isPrimary) {
          if (!EFFORT_STYLES.has(model.reasoning?.style)) {
            bad(`${name}.${task} sets effort "${spec.effort}" but ${ref} (${model.reasoning?.style}) does not accept one`);
          } else if (model.reasoning?.values && !model.reasoning.values.includes(spec.effort)) {
            bad(`${name}.${task} effort "${spec.effort}" is not valid for ${ref} (allowed: ${model.reasoning.values.join(', ')})`);
          }
          entry.effort = spec.effort;
        } else if (!EFFORT_STYLES.has(model.reasoning?.style)) {
          warn(`${name}.${task} fallback ${ref} does not take an effort — the bridge will drop it`);
        }
      }
    }
  }
}

for (const [ref, entry] of routed) {
  ok(`routed model ${ref} (${entry.primary ? 'primary' : 'fallback'})`);
}

// ---------------------------------------------------------------- triggers ---

for (const [name, trigger] of Object.entries(config.triggers || {})) {
  const agent = config.agents?.[trigger.agent];
  if (!agent) {
    bad(`trigger "${name}" → unknown agent "${trigger.agent}"`);
    continue;
  }
  if (!agent.tasks?.[trigger.task]) {
    bad(`trigger "${name}" uses task "${trigger.task}" which ${trigger.agent} does not declare`);
  }
  if (!config.prompts?.[trigger.task]) {
    bad(`trigger "${name}" has no prompt for task "${trigger.task}"`);
  }
  ok(`trigger "${name}" → ${trigger.agent}.${trigger.task}`);
}

// --------------------------------------------------------------- allowlist ---

for (const path of config.tools?.write_allowlist || []) {
  if (isAbsolute(path)) bad(`write allowlist entry is an absolute path: ${path}`);
  else if (path.includes('..')) bad(`write allowlist entry escapes the repo: ${path}`);
  else ok(`write allowlist: ${path}`);
}

// -------------------------------------------------------------- team config ---

if (existsSync(TEAM_CONFIG_PATH)) {
  try {
    const team = JSON.parse(readFileSync(TEAM_CONFIG_PATH, 'utf8'));
    for (const [name, spec] of Object.entries(team.agents || {})) {
      const ids = [spec.model_default, ...Object.values(spec.models || {})].filter(Boolean);
      for (const id of ids) {
        if (!models[id]) bad(`agents/team.config.json → ${name} uses unknown model "${id}"`);
      }
      if (ids.length) ok(`agents/team.config.json → ${name} = ${ids.join(', ')}`);
    }
    if (team.provider?.name && team.provider.name !== 'multi') {
      warn(`agents/team.config.json pins provider "${team.provider.name}" — the factory is multi-provider`);
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
console.log(
  `✓ router OK — ${Object.keys(providers).length} providers, ${modelIds.length} models, ` +
    `${Object.keys(config.agents || {}).length} agents, ${Object.keys(config.triggers || {}).length} triggers` +
    `${warned ? ` (${warned} warning(s))` : ''}`,
);
