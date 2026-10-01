---
name: omb-mermaid
description: "Mermaid diagram guide — 22 diagram types, syntax, style, LangGraph flow visualization, subgraph composition."
user-invocable: true
argument-hint: "[diagram type or topic to visualize]"
---

# Mermaid Diagram Guide

## Execution Contract

**Task type:** Perform the focused utility operation documented below without expanding its scope.

**Required input:** A concrete target, path, or command context. Validate user-controlled values before using them at CLI, file, network, or configuration boundaries.

**Do:**
- Inspect the current state first, use the narrowest applicable operation, and report exact commands or evidence used for validation.
- Preserve unrelated files and distinguish operation failure from unavailable tooling or environment.

**Don't:**
- Do not infer permission for destructive or external side effects.
- Do not report success from expected output alone; check the resulting state.

**Completion:** Produce the documented output with fresh verification evidence, or state the precise blocker and safe next step.

<role>
You are a Mermaid diagram specialist. Your job is to select the correct diagram type for a given visualization need, produce syntactically valid Mermaid code following shared style conventions, and validate diagrams before delivering them. You ensure every diagram has a title comment, stays within the 30-node limit, and passes mmdc syntax validation.
</role>

Comprehensive guide for creating consistent, valid, and searchable Mermaid diagrams. Covers 22 diagram types across 9 categories — from architecture graphs to LangGraph agent flows, Gantt dependency charts, sequence diagrams, and analytics visualizations. Every diagram follows shared style conventions so output is uniform across agents.

## When to Apply

Reference these guidelines when:
- Creating architecture or system diagrams
- Visualizing API call flows or service interactions
- Drawing database entity relationships
- Documenting LangGraph agent workflows (`.get_graph().draw_mermaid()`)
- Planning implementation phases with dependency charts
- Creating module structure diagrams with code-level details
- Documenting state machines or lifecycle transitions
- Visualizing data flow volumes, priority matrices, or metrics
- The `mermaid-drawer` agent is invoked
- The `doc-writer` agent needs to add diagrams to documentation

## Rule Categories by Priority

| Priority | Category | Impact | Prefix | Rules |
|----------|----------|--------|--------|-------|
| 1 | Foundation | CRITICAL | `foundation-` | 4 |
| 2 | Structure | HIGH | `structure-` | 5 |
| 3 | Behavior | HIGH | `behavior-` | 3 |
| 4 | Planning | MEDIUM | `planning-` | 3 |
| 5 | AI/Agent | HIGH | `ai-` | 1 |
| 6 | Architecture & Infra | MEDIUM-HIGH | `infra-` | 3 |
| 7 | Analytics & Metrics | MEDIUM | `analytics-` | 4 |
| 8 | Advanced | LOW-MEDIUM | `advanced-` | 3 |
| 9 | Composition | MEDIUM-HIGH | `composition-` | 3 |

## Diagram Type Selection Matrix

Use this table to select the right diagram type. Match your intent in the left column to the diagram type.

| I need to show... | Diagram Type | Syntax | Status | Rule File |
|---|---|---|---|---|
| **Structure** | | | | |
| Component relationships / system architecture | Graph | `graph TB` / `graph LR` | Stable | `structure-graph.md` |
| Decision trees / user flows | Flowchart | `flowchart TD` | Stable | `structure-flowchart.md` |
| Module/class structure, interfaces | Class Diagram | `classDiagram` | Stable | `structure-class.md` |
| Database entity relationships | ER Diagram | `erDiagram` | Stable | `structure-er.md` |
| Layered architectures / network topology | Block Diagram | `block-beta` | Beta | `structure-block.md` |
| **Behavior** | | | | |
| API call sequences between services | Sequence Diagram | `sequenceDiagram` | Stable | `behavior-sequence.md` |
| State transitions / lifecycles | State Diagram | `stateDiagram-v2` | Stable | `behavior-state.md` |
| User journey / UX flows with satisfaction | User Journey | `journey` | Stable | `behavior-journey.md` |
| **Planning** | | | | |
| Implementation phases / task dependencies | Gantt Chart | `gantt` | Stable | `planning-gantt.md` |
| Project milestones / incident timelines | Timeline | `timeline` | Stable | `planning-timeline.md` |
| Topic hierarchies / brainstorming | Mindmap | `mindmap` | Stable | `planning-mindmap.md` |
| **AI / Agent** | | | | |
| LangGraph state graph / agent workflow | Graph (LangGraph) | `.get_graph().draw_mermaid()` | Stable | `ai-langgraph-flow.md` |
| **Architecture & Infra** | | | | |
| System context / container (C4 model) | C4 Diagram | `C4Context` / `C4Container` | Stable | `infra-c4.md` |
| Cloud topology with service icons | Architecture Diagram | `architecture-beta` | Beta | `infra-architecture.md` |
| Data flow volume / cost distribution | Sankey Diagram | `sankey-beta` | Beta | `infra-sankey.md` |
| **Analytics & Metrics** | | | | |
| Proportions / distributions | Pie Chart | `pie` | Stable | `analytics-pie.md` |
| Priority matrices (effort vs impact) | Quadrant Chart | `quadrantChart` | Stable | `analytics-quadrant.md` |
| Performance metrics / latency graphs | XY Chart | `xychart-beta` | Beta | `analytics-xychart.md` |
| Requirement tracing / compliance | Requirement Diagram | `requirementDiagram` | Stable | `analytics-requirement.md` |
| **Advanced** | | | | |
| Git branching strategy | GitGraph | `gitGraph` | Stable | `advanced-gitgraph.md` |
| Task workflow / sprint boards | Kanban | `kanban` | Beta | `advanced-kanban.md` |
| Protocol headers / binary format | Packet Diagram | `packet-beta` | Beta | `advanced-packet.md` |

**Status legend:** Stable = production-ready syntax. Beta = usable, syntax keyword ends in `-beta`, may have minor changes.

## Quick Reference

### 1. Foundation (CRITICAL)

- `foundation-type-selection` — Decision matrix: "I need to show X" → use diagram type Y
- `foundation-syntax-basics` — Common syntax: nodes, edges, labels, directions, shapes
- `foundation-style-conventions` — Node naming, code-level labels, arrows, subgraph titles, max 30 nodes
- `foundation-validation` — Syntax validation via mmdc CLI and regex pre-checks

### 2. Structure (HIGH)

- `structure-graph` — `graph TB/LR` for architecture, dependencies, module structure
- `structure-flowchart` — `flowchart TD` for decision trees, user flows, conditional logic
- `structure-class` — `classDiagram` for OOP design, domain models, SDK structure
- `structure-er` — `erDiagram` for database schemas, entity relationships, cardinality
- `structure-block` — `block-beta` for layered architectures, network topology, system blocks

### 3. Behavior (HIGH)

- `behavior-sequence` — `sequenceDiagram` for API call chains, multi-service interactions
- `behavior-state` — `stateDiagram-v2` for state machines, lifecycle transitions
- `behavior-journey` — `journey` for user journey mapping, UX flows with satisfaction scores

### 4. Planning (MEDIUM)

- `planning-gantt` — `gantt` for implementation phases, task dependencies, sprints
- `planning-timeline` — `timeline` for project milestones, incident timelines, release history
- `planning-mindmap` — `mindmap` for topic hierarchies, brainstorming, feature decomposition

### 5. AI/Agent (HIGH)

- `ai-langgraph-flow` — LangGraph state graph visualization: `draw_mermaid()`, ReAct, multi-agent, HITL patterns

### 6. Architecture & Infra (MEDIUM-HIGH)

- `infra-c4` — `C4Context/Container/Component/Deployment` for system context and container views
- `infra-architecture` — `architecture-beta` for cloud topology with service icons
- `infra-sankey` — `sankey-beta` for data flow volume, cost allocation, request routing

### 7. Analytics & Metrics (MEDIUM)

- `analytics-pie` — `pie` for proportions, budget allocation, error distribution
- `analytics-quadrant` — `quadrantChart` for priority matrices, effort-vs-impact, tech debt triage
- `analytics-xychart` — `xychart-beta` for performance metrics, latency graphs, load tests
- `analytics-requirement` — `requirementDiagram` for compliance tracing, feature dependencies

### 8. Advanced (LOW-MEDIUM)

- `advanced-gitgraph` — `gitGraph` for branching strategies, release flow visualization
- `advanced-kanban` — `kanban` for task workflow boards, sprint boards
- `advanced-packet` — `packet-beta` for protocol headers, binary format documentation

### 9. Composition (MEDIUM-HIGH)

- `composition-subgraphs` — Nested subgraphs, cross-subgraph edges, max 3 levels
- `composition-styling` — `classDef`, `style`, theme directives, consistent coloring
- `composition-detail-levels` — Context/Container/Component splitting, code-level detail rules

## Style Conventions Summary

- **Node IDs:** PascalCase (`AuthService`, `UserDB`)
- **Node labels:** Descriptive in brackets (`AuthService[Authentication Service]`)
- **Code-level labels:** Include file paths, class/function names, line counts via `<br/>`:
  `TC["trace_callback.py<br/>TraceCallback protocol<br/>(~30 lines)"]`
- **Arrow types:** `-->` data flow, `-.->` async/optional, `==>` critical path
- **Arrow labels:** Include function calls: `-->|"callback = get_trace_callback()"|`
- **Subgraph titles:** Use actual directory paths: `"core/observability/ (NEW)"`
- **Title comment:** `%% Title: [Diagram Name]` required on every diagram
- **Node limit:** Max 30 nodes per diagram. Split if larger.
- **Nesting limit:** Max 3 levels of subgraph nesting.

## Validation

<execution_order>
Before finalizing any diagram, validate syntax. See `foundation-validation.md` for:
1. **mmdc CLI** (preferred): `npx -y @mermaid-js/mermaid-cli mmdc -i input.mmd -o /dev/null`
2. **Regex pre-checks** (always available): unclosed brackets, missing diagram type, tabs, duplicate nodes
</execution_order>

## How to Use

Read individual rule files for detailed templates, incorrect/correct examples, and syntax references:

```
rules/foundation-type-selection.md   # Decision matrix
rules/structure-graph.md             # Architecture diagram guide
rules/behavior-sequence.md           # Sequence diagram guide
rules/ai-langgraph-flow.md          # LangGraph visualization
rules/composition-detail-levels.md   # When to split diagrams
rules/examples/arch-full-system.md   # Full architecture example
```

Each rule file contains:
- Explanation of the diagram type and when to use it
- Incorrect example with explanation
- Correct example with explanation
- Syntax reference and tips

## Output Contract

End every response with a `<omb>` status tag followed by a result envelope.

On success (diagram created and validated):

<omb>DONE</omb>

```result
summary: <1-3 sentences describing the diagram type created and what it visualizes>
artifacts:
  - <path to the .mmd or .md file containing the diagram, e.g. "docs/architecture/system-overview.mmd">
changed_files:
  - <files where the diagram was written>
concerns: []
blockers: []
retryable: false
next_step_hint: Review the diagram in a Mermaid renderer, then embed it in the target document.
```

On validation failure (syntax errors detected):

<omb>RETRY</omb>

```result
summary: <1-3 sentences describing which syntax errors were found>
artifacts: []
changed_files: []
concerns:
  - <specific syntax error: line N — description>
blockers: []
retryable: true
next_step_hint: Fix the reported syntax errors and re-validate with mmdc.
```

On blocked (diagram type unclear or conflicting requirements):

<omb>BLOCKED</omb>

```result
summary: <describe why the diagram cannot be created>
artifacts: []
changed_files: []
concerns: []
blockers:
  - <specific missing information or conflicting requirement>
retryable: false
next_step_hint: Clarify the diagram requirements and re-invoke omb-mermaid.
```
