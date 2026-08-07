<!-- TRELLIS:START -->
# Trellis Instructions

These instructions are for AI assistants working in this project.

This project is managed by Trellis. The working knowledge you need lives under `.trellis/`:

- `.trellis/workflow.md` — development phases, when to create tasks, skill routing
- `.trellis/spec/` — package- and layer-scoped coding guidelines (read before writing code in a given layer)
- `.trellis/workspace/` — per-developer journals and session traces
- `.trellis/tasks/` — active and archived tasks (PRDs, research, jsonl context)

If a Trellis command is available on your platform (e.g. `/trellis:finish-work`, `/trellis:continue`), prefer it over manual steps. Not every platform exposes every command.

If you're using Codex or another agent-capable tool, additional project-scoped helpers may live in:
- `.agents/skills/` — reusable Trellis skills
- `.codex/agents/` — optional custom subagents

Managed by Trellis. Edits outside this block are preserved; edits inside may be overwritten by a future `trellis update`.

<!-- TRELLIS:END -->

# Taskcraft Development Contract

## Product invariants

- Taskcraft is agent-first. Codex and Claude Code are the first supported hosts.
- SQLite is the sole writable Task Store and the Command service is the sole write entry.
- Lifecycle definitions are immutable, normalized facts in `lifecycle_revisions`, `lifecycle_nodes`, `lifecycle_edges` and `obligation_definitions`.
- Runtime facts live in tasks, attempts, Review links/findings, obligation results, evidence, blockers and events.
- `agent_runs` stores host observations. Reducer commands convert observations into runtime decisions.
- The single reducer writes facts and the single projector derives the five public states: `queued`, `active`, `waiting`, `done`, `cancelled`.
- A `waiting` projection includes a typed `waitingReason`; retry exhaustion uses `failed_retries_exhausted`.
- Task Level records the Agent's governance judgment. Required obligations generated for the current lifecycle revision form the completion contract.
- Execute and Review use separate typed nodes and attempts. Each Review link records its `reviewed_attempt_id`, capability and independence status.
- L3 requires an independent feasibility Review of the main Agent's Plan before Execute becomes runnable. Probe results append Task facts and evidence.
- Lifecycle revisions advance on one line. Stable node ids express semantic lineage; older revisions, attempts and evidence remain referenceable.
- Host values are `codex` and `claude`. Node kinds are `frame`, `plan`, `execute`, `review`, `integrate` and `record`.
- Execution ownership and the Taskcraft tool boundary follow `development/specs/architecture.md`, section 2.
- Node Brief and continuous execution behavior follow `development/specs/lifecycle.md`, section 7.
- Takeover remains silent while disabled or while the request has no durable execution requirement.
- Required obligations and explicit reducer outcomes provide the task's auditable closure.

## Scope of this repository

This repository contains product research, contracts, schemas and an interaction prototype. Prototype data and UI state illustrate projections; production facts come from the SQLite contract.

## Validation order

1. Contract and schema tests for changed behavior.
2. Reducer and transaction tests.
3. Codex and Claude adapter conformance.
4. Desktop and mobile Watch smoke tests.
5. Real-host lifecycle samples before capability claims.
