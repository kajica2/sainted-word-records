// qa/a11y.mjs — the shared accessibility probe.
//
// WHY
// ---
// The KAI SWARM surface checks three things about a page: it loads, it
// throws nothing, and it does not scroll sideways. None of those is
// whether a person who cannot see the page, or who navigates it with a
// keyboard, can use it. axe-core answers that question mechanically, and
// the answer is the same on every machine, so it belongs in a gate rather
// than in a review.
//
// This module is the ONE place axe is invoked. Two callers use it:
//
//   qa/swarm-runner.mjs     the swarm's measurement tool — it aggregates
//                            the violations BY RULE across the whole
//                            surface, because a per-instance list would
//                            be a flood and a flood is not a work item.
//   scripts/check-a11y.mjs  the gate — it compares the per-rule counts
//                            against a committed baseline and fails on a
//                            regression.
//
// WHY AXE IS A DEPENDENCY AND NOT A CDN FETCH
// -------------------------------------------
// A gate that fetches its tool from the network is a gate that fails when
// the network fails, and it cannot tell "the page has a contrast problem"
// from "fonts.googleapis.com was slow today". axe-core is a devDependency
// with no runtime cost: the site never loads it, only the tools do.

import { readFileSync } from 'node:fs';

// Resolved against THIS file, so it works from the repo root and from a
// worktree alike (a worktree's node_modules is a link to the root's).
const AXE_PATH = new URL('../node_modules/axe-core/axe.min.js', import.meta.url);

let cached = null;
export function axeSource() {
  if (cached === null) cached = readFileSync(AXE_PATH, 'utf8');
  return cached;
}

/**
 * Run axe against the page's current DOM.
 *
 * Returns one entry per violated rule, each with the rule id, its impact,
 * how many nodes break it, and a sample of WHAT breaks it — the target
 * selector and the failure summary. A rule id alone is not actionable;
 * `color-contrast` without the element is a rule name, not a defect.
 */
export async function runAxe(page, { timeout = 30000 } = {}) {
  await page.addScriptTag({ content: axeSource() });
  const violations = await page.evaluate(async (ms) => {
    if (!window.axe) return [{ id: 'axe-not-loaded', impact: 'critical', help: 'axe did not load', nodes: 1, samples: [] }];
    const result = await window.axe.run(document, {
      resultTypes: ['violations'],
      timeout: ms,
    });
    return result.violations.map(v => ({
      id: v.id,
      impact: v.impact || 'unknown',
      help: v.help,
      nodes: v.nodes.length,
      samples: v.nodes.slice(0, 3).map(n => ({
        target: Array.isArray(n.target) ? n.target.join(' ') : String(n.target),
        summary: (n.failureSummary || '').split('\n').filter(Boolean).slice(0, 2).join(' '),
      })),
    }));
  }, timeout);
  return violations;
}

/**
 * Fold a page's violations into per-rule counts.
 *
 * `counts` is the shape a baseline stores: rule id → number of instances.
 * `detail` keeps the worst sample per rule so a finding can name an
 * element.
 */
export function tally(violations) {
  const counts = {};
  const detail = {};
  for (const v of violations) {
    counts[v.id] = (counts[v.id] || 0) + (v.nodes || 1);
    if (!detail[v.id]) detail[v.id] = { impact: v.impact, help: v.help, sample: v.samples?.[0] || null };
  }
  return { counts, detail };
}
