# Implementation queue

## Approved scope and authority

User approved queues A–E, Luna/max subagents, new feature branch, final commit and push to origin. Their latest message explicitly authorizes beginning. No further planning/commit permission is needed within this scope. Genuine unresolved product decisions or subagent infrastructure failures must be surfaced.

## Queue

1. [x] Verify clean main at 973423740b124b216124e6c397b7fa1ec769f112; gh auth succeeds.
2. [x] Create feat/evals-batch-and-scenarios, record PRD/design/ownership, read applicable guidelines.
3. [ ] Commit task baseline and allocate five isolated worktrees outside the repository. Each lane gets one writer and may commit only its task files; no child pushes or spawns agents.
4. [ ] Dispatch A batch, B verdict/board, C blind judge, D L2, E normal-session resume together through one native async workflow. All children use company/gpt-5.6-luna:max.
5. [ ] One integration child cherry-picks verified lane commits, resolves intended overlap, wires batch loading/new cases, writes scenario guide/README, and performs full automated validation.
6. [ ] Two fresh read-only Luna/max reviewers run in parallel: batch/verdict/board and scenarios/judge/claim boundaries. They return evidence-backed findings; only structured blocked verdict blocks the workflow gate.
7. [ ] Sole integration child handles accepted findings; focused re-review as needed, bounded to three rounds. Infrastructure/setup/tooling errors stop the workflow and are never silently replaced by external CLI execution.
8. [ ] Parent validates final diff, branch/ref, command evidence and clean status; records task/spec/session completion, commits bookkeeping, and pushes the feature branch to origin without merging main.

## Validation

- Per lane: focused meaningful Vitest tests with 60-second hard timeout where practical; affected type/lint/format checks. Build uses lane-local dist. Only node_modules is shared read-only through a symlink.
- Integrated: pnpm test; pnpm typecheck; pnpm lint; pnpm format:check; pnpm build; pnpm smoke:evals; actual board HTTP page/data request. Tests must isolate synthetic reports in tmpdirs.
- No real model case/judge executions locally. Real model Evals belong to QA after commit/deployment; independent coding subagent reviews are not model evaluation evidence.
- Preserve all old reports. Any new source helper affecting case/grader behavior must be accounted for by existing provenance semantics.

## Recovery

Lane reports use managed subagent artifacts. Git commits and worktree identity are durable handoffs. Do not delete an active or dirty worktree. If launch or child runtime fails, capture exact status and diff and use a same-protocol recovery only. No force push, reset, or deletion of unrelated changes.
