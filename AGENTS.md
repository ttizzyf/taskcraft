# Taskcraft Agent Instructions

These instructions are for AI assistants working in this project.

This repository manages its own development tasks with **Taskcraft (`tc`)**.
Trellis was fully uninstalled on 2026-09-27; see
`development/migrations/trellis-cutover-2026-09-27.md` for the cutover record
and the `trellis-final` git tag for the archived Trellis state. The project's
authoritative truth (product specs, engineering contracts, ADRs) lives under
`.taskcraft/spec/` (ADR 0011); `tc spec list` is the directory.

## Daily task workflow

- Create work as tc tasks: `tc task new --title "<title>" --level <1|2|3> --reason "<judgment>"`.
- Pick up work with `tc` or `tc task next`; the output includes the runnable Node Brief.
- Complete nodes with `tc run complete <task-id> --result <json|@path|@->`;
  Record results must include a Spec Impact (`none|updated|candidate`).
- L2+ tasks use `tc review start|pass|changes|replan` for the review loop.
- `tc doctor` is the read-only health check; `tc spec list` shows registered
  truth bodies under `.taskcraft/spec/` (product specs, engineering contracts,
  ADRs in `decisions/`).
- Entry hooks inject an active-task breadcrumb at session start; follow it to
  resume exactly one active task.

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
- L3 requires a feasibility Review attempt before Execute becomes runnable. Use an independent reviewer when available; otherwise disclose `same-actor`. Check results append Task facts and evidence.
- An accepted L3 Plan selects `modules` or `single`. Modules atomically materialize a one-level set of real L1/L2 child tasks with explicit anchor coverage and dependency facts; nested L3 is forbidden. Child planning is inherited from the accepted parent Plan without fake host Attempts.
- Lifecycle revisions advance on one line. Stable node ids express semantic lineage; older revisions, attempts and evidence remain referenceable.
- Host values are open strings; the first supported adapters are `codex` and `claude`. Node kinds are `frame`, `plan`, `execute`, `review`, `integrate` and `record`.
- Execution ownership and the Taskcraft tool boundary follow `.taskcraft/spec/product/architecture.md`, section 2.
- Node Brief and continuous execution behavior follow `.taskcraft/spec/product/lifecycle.md`, section 7.
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
