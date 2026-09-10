# Implementation queue

## Approved scope and authority

User approved queues A–E, Luna/max subagents, new feature branch, final commit and push to origin. Their latest message explicitly authorizes beginning. No further planning/commit permission is needed within this scope. Genuine unresolved product decisions or subagent infrastructure failures must be surfaced.

## Queue

1. [x] Verify clean main at 973423740b124b216124e6c397b7fa1ec769f112; gh auth succeeds.
2. [x] Create feat/evals-batch-and-scenarios, record PRD/design/ownership, read applicable guidelines.
3. [x] Commit task baseline and allocate five isolated worktrees outside the repository. Each lane gets one writer and may commit only its task files; no child pushes or spawns agents.
4. [x] Dispatch A batch, B verdict/board, C blind judge, D L2, E normal-session resume together through one native async workflow. All children use company/gpt-5.6-luna:max.
5. [x] One integration child cherry-picks verified lane commits, resolves intended overlap, wires batch loading/new cases, writes scenario guide/README, and performs full automated validation.
6. [x] Two fresh read-only Luna/max reviewers run in parallel: batch/verdict/board and scenarios/judge/claim boundaries. They return evidence-backed findings; only structured blocked verdict blocks the workflow gate.
7. [x] Sole integration child handles accepted findings; focused re-review as needed, bounded to three rounds. Infrastructure/setup/tooling errors stop the workflow and are never silently replaced by external CLI execution.
8. [ ] Parent validates final diff, branch/ref, command evidence and clean status; records task/spec/session completion, commits bookkeeping, and pushes the feature branch to origin without merging main.

## Integration progress

- Cherry-picked exactly the five lane commits A `fddb43a`, B `a297c800`, C `b953695`, D `04b3999`, and E `e470b00`.
- Registered five cases and added complete Chinese guides for `l2-review` and `session-resume`; updated README batch/resume, evidence-boundary, history, and QA instructions.
- Connected batch ledger summaries and validated internal JSON/Markdown reports to the read-only board; unsafe paths, mismatched case/verdict, invalid reports, and missing markdown remain diagnostics.
- Added typed L2 quoted judge evidence through runner/prompt/report, removed the blind judge `codeChecks` parameter, and kept unestablished normal handoff inconclusive without hard artifact/task checks.
- Added provenance source coverage for every L2 execution/grading/evidence helper; no build hash or historical report rewrites.
- Integrated validation completed locally; no paid Actor/Judge execution was performed. Parent still owns final diff review, integration commit bookkeeping, and push.

## Validation

- Per lane: focused meaningful Vitest tests with 60-second hard timeout where practical; affected type/lint/format checks. Build uses lane-local dist. Only node_modules is shared read-only through a symlink.
- Integrated: pnpm test; pnpm typecheck; pnpm lint; pnpm format:check; pnpm build; pnpm smoke:evals; actual board HTTP page/data request. Tests must isolate synthetic reports in tmpdirs.
- No real model case/judge executions locally. Real model Evals belong to QA after commit/deployment; independent coding subagent reviews are not model evaluation evidence.
- Preserve all old reports. Any new source helper affecting case/grader behavior must be accounted for by existing provenance semantics.

## Final integrated validation

- `pnpm test`: passed, 92 files / 620 tests.
- `pnpm typecheck`: passed; `pnpm lint`: passed; `pnpm format:check`: passed.
- `pnpm build`: passed; `pnpm smoke:evals`: passed, 4 browser tests on desktop/mobile and context polling.
- Real HTTP smoke: `GET /` and `GET /api/data` both returned 200; API contained 5 scenarios and 6 historical reports.
- `git diff --check`: passed. No paid Actor/Judge calls were made. Parent owns final branch push and task archival.

## Recovery

Lane reports use managed subagent artifacts. Git commits and worktree identity are durable handoffs. Do not delete an active or dirty worktree. If launch or child runtime fails, capture exact status and diff and use a same-protocol recovery only. No force push, reset, or deletion of unrelated changes.
