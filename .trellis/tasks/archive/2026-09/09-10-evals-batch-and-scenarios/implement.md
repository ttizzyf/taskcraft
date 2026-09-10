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
7. [x] Sole integration child handles accepted findings; three primary review rounds followed by one focused provenance fix/review closed every confirmed finding. Infrastructure/setup/tooling errors use the same native protocol; no external CLI fallback was used.
8. [x] Parent validated final diff, branch/ref, command evidence, clean status and all 12 historical report hashes; code commit `1781867` was pushed to origin. Task archival and journal record are the final bookkeeping steps.

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

## Reviewer fix round

- Added a shared strict `tc-eval/v1` decoder for board loading and batch producer settlement; unknown verdicts, invalid grader/status values, and non-string diagnostics now become malformed/inconclusive instead of decisive results or loader exceptions.
- Restricted batch IDs to one directory name, added realpath/symlink containment for batch report references, and made malformed finished reports settle as `inconclusive` rather than terminal `pass`/`fail`.
- Cancellation cleanup now tracks known descendants through worker close and continues grace/SIGKILL cleanup for detached descendants; the regression fixture covers a SIGTERM-ignoring child.
- L2 task completion is inconclusive when the final snapshot is unavailable; normal `session-resume` now forwards typed first-session handoff/source/task/attempt evidence to the blind judge/report on both established and unestablished paths.
- Focused reviewer regression checks passed: 6 Evals test files / 21 tests, board data and server tests, Evals typecheck, affected ESLint/Prettier, and `git diff --check`.

## Parent acceptance

- Final code commit: `17818674c1a28d955f0d8e0c1a2de80d4c0aba4d`, pushed to `origin/feat/evals-batch-and-scenarios`; no merge into main.
- All confirmed review findings are closed. Batch/report review passed at `778ed7b`; scenario/evidence review passed at `fa9635b`, with the subsequent shared-helper provenance gap fixed and independently passed at `1781867`.
- Final boundary changes at `778ed7b`: 110 Evals tests and 4 browser smoke tests passed. Final provenance-only change: 10 targeted tests passed, plus Evals typecheck and affected lint/format. The earlier full-project integration run passed 620 tests, typecheck, lint, format and build; those were not misrepresented as a repeated final-HEAD full run.
- Parent restarted the previously owned local board process and made real requests: `http://127.0.0.1:3100/` and `/api/data` returned 200; the API showed 5 scenarios, 6 historical reports and 0 batches. The server remains available for inspection.
- The original six real runs' 12 JSON/Markdown files match the lane manifest byte-for-byte. No synthetic reports were added to formal `evals/runs/` and no new real Actor/Judge evaluations ran locally.
- QA checks out/builds the pushed commit and runs real evaluations with the configured host. Reports capture QA's actual subject Git SHA separately from evaluation-method fingerprints; no built-artifact hash or human-calibration claim was added.
- Existing README and executable regressions capture the Evals contracts; production specs and `src/` required no change. Only this active task is archived; unrelated task records and lane worktrees are retained.
- Review evidence is retained in native workflow receipts `60d82e29-de4e-4c8a-ae36-7d7ce41a2f52` and `064f382e-4733-41f6-9cbe-b37e6e0a0a3e`, including structured verdicts and precise reproductions.

## Recovery

Lane reports use managed subagent artifacts. Git commits and worktree identity are durable handoffs. Do not delete an active or dirty worktree. If launch or child runtime fails, capture exact status and diff and use a same-protocol recovery only. No force push, reset, or deletion of unrelated changes.
