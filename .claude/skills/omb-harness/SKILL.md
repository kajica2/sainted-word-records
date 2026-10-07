---
name: omb-harness
description: ".claude/ harness management — create, update, verify agents, skills, hooks, rules, settings.json, CLAUDE.md."
allowed-tools: Read, Write, Edit, Bash, Grep, Glob, Agent, AskUserQuestion
argument-hint: "[--verify | --prompt | --fix | --plan] [target or task description]"
---

# Harness mode router

Manage harness configuration through the shared execution owner
`.claude/skills/omb-harness/references/orchestration.md`. Read it before delegation;
this wrapper only resolves arguments and scope, not a second agent workflow.

## Arguments

`omb:harness [--verify | --prompt | --fix | --plan] [target or task description]`

1. Select the single supplied mode flag and remove it from the target string.
   Multiple flags require a single user choice; do not guess a writing mode.
2. With no flag, mode is default. Resolve the authorized target from the task.
3. Missing verify target means all harness files. Missing prompt target means all
   harness agent/skill Markdown allowed by the shared scope. Fix and plan require
   a concrete target; ask only if the active user request does not already supply it.
4. Pass mode, target, original task, allowed paths and knowledge_context to the
   shared reference. It owns agent selection, retry/watchdog, write boundaries and
   independent verification. Follow its matrix; --plan stops before implementation,
   --verify stays read-only, and writing modes require their terminal checks.
5. Return the complete output envelope and actual outcome from the shared flow.

## Context Passing

Follow `.claude/skills/omb-context/references/workflow-handoff.md`. Preserve
knowledge_context and evidence_ids across every agent and retry; let the main host
rebuild stale bundles. No generic search or ranking policy belongs in this router.
