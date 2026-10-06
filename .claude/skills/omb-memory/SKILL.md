---
name: omb-memory
description: "Shared operational memory — recall project practices and merge explicit corrections into bounded Git-tracked core and progressive topics."
user-invocable: true
argument-hint: "[init | recall <task> | remember <instruction> | reflect | forget <topic>]"
---

# Project Operational Memory

Use this skill for how to work in this project: conventions, proven shortcuts,
cross-repository coordination, and documentation update routes. Source facts and
architecture evidence belong in the Wiki. Memory never overrides the current
user request or project instructions and never authorizes additional actions.

## Ownership and activation

- Bind an absolute active checkout root; never substitute the primary Git database root.
- Use `omb memory init --root ABS_ROOT` for first use. It creates empty, Git-trackable
  `.omb-memory/` and a managed AGENTS bootstrap without inventing project facts.
- The main agent is the only semantic writer. Subagents return proposed observations
  with evidence and scope; they do not concurrently edit shared memory.
- Use the installed `omb` CLI or the checkout's OMB CLI wrapper. If neither runs,
  report memory unavailable; do not bypass validation with direct file reads/writes.
- At startup, after compaction, or on checkout change, use `omb memory context --root ABS_ROOT`.
  If the same checkout and layer revisions are already present, do not inject them again.
  Recheck revisions at workflow entry when changes may have occurred; a new revision
  requires reloading. A hook configuration is not proof of live host delivery.

## Recall progressively

1. Start from the bounded core and root index. Do not load every topic.
2. Match the task's affected repositories, paths, operations, and index descriptions.
3. Use `.claude/bin/omb-cli.sh context search QUERY --root ABS_ROOT --source memory --limit 3`, then
   `omb memory read --root ABS_ROOT --path knowledge/TOPIC.md` for selected local topics.
   Shared results require `--layer workspace`; identical paths are distinct by layer.
4. Start with 1–3 relevant stable topics within the workflow's existing context budget.
   Follow a child index only when its description matches the current operation.
   Preserve applicability and exceptions; never truncate them into a broader instruction.
5. Treat draft/deprecated topics and conflicting instructions as evidence to reconcile,
   not active policy. Verify referenced code, commands, and exact skills before use.

The shared engine calls validated memory APIs directly; it never invokes this
skill, so recall cannot recurse. Preserve root/layer/revision and complete topic
conditions under `.claude/skills/omb-context/references/workflow-handoff.md`. The existing memory CLI stays compatible.
Writer and reflection modes follow `.claude/skills/omb-context/references/knowledge-disposition.md` for revision/read-back receipts.

## Direct feedback: act in the same turn

Direct requests such as “기억해줘”, “명심해줘”, “앞으로 이 프로젝트에서는…”,
“remember this”, and “from now on” trigger a memory update in the same turn.
Interpret the intent, not a keyword match:

- “기억해줘: API를 바꾸면 프론트 소비자도 확인해” is a durable project instruction.
- “'기억해줘'라는 문구를 UI에 넣어” is quoted content, not a memory request.
- “이건 기억하지 마” / “do not remember this” is negated; do not create a memory.
- “이번 작업에서만 테스트를 줄여” is temporary; keep it in task context.
- “기존 API 규칙을 잊어줘” requests removal or narrowing of the matching memory.

For an actual request, read [content-policy.md](references/content-policy.md), then:

1. Read status and relevant existing core/topics. Identify target layer and scope.
   Default to repository scope; shared workspace changes need explicit applicable intent.
2. Choose create, merge, replace, move, deprecate, delete, or no-op. Resolve the old
   conflicting sentence instead of appending another competing instruction.
3. Preserve conditions, action, rationale, exceptions, and evidence. A user assertion
   is a dated user assertion; it is not code verification. Never fabricate `verified`.
4. Build an update JSON with the observed revision, complete replacement text for each
   changed document, and explicit deletes. Generated indexes are not editable inputs.

   ```json
   {"expected_revision":"REVISION","writes":{"MEMORY.md":"REVISED CORE\n"},"deletes":[]}
   ```

5. Run `omb memory apply --root ABS_ROOT --file ABS_UPDATE_JSON`. For shared changes,
   use that shared checkout as the explicit root in a separate transaction.
6. On a stale revision, reread and semantically merge before retrying. On overflow,
   shorten repeated content or move detail into a topic without losing exceptions.
   On recovery conflict or invalid memory, preserve files and report the concrete failure.
7. Perform read-back with `read`/`context` and compare the intended rule, old conflict
   removal, and scope. Only then report the saved path and concise change.

Saving locally is not a commit, push, merge, or team sync. Include the shared memory
diff in the normal authorized code-review/Git workflow; never auto-publish per turn.
Do not store credentials, personal machine paths, transcripts, or temporary task logs.

## Reflection after verified work

After existing task verification, consider only new reusable operational learning:
an explicit correction, a demonstrated convention, a proven work method, a repeatable
failure avoidance step, or a verified repository/SoT route. No new learning means no-op.
One incidental success does not establish a general rule: preserve its narrow conditions
or retain it as a draft until corroborated. Recurrence of an existing correction calls for
checking loading, applicability and execution before adding content.

Apply the same merge and read-back process. Do not automatically promote observations
to global rules, skills, or verified claims. Report verification limitations honestly.

## Completion

Report what was recalled or changed, evidence and scope, actual read-back result,
and whether the change is merely local or already included in an authorized Git action.
Missing storage is distinct from invalid storage and unavailable tooling.
