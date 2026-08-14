# Implementation plan: remove Stop Hook

## 1. Freeze the product contract

- [x] Add ADR 0009 for agent-driven continuation and update the ADR index.
- [x] Rewrite `development/specs/lifecycle.md` §7 first: active tasks may
      outlive a turn; Entry restores; typed waiting is the escape boundary.
- [x] Align `architecture.md`, `cli.md`, and `product.md` with Entry-only hooks.

## 2. Collapse Adapter and Hook contracts to Entry-only

- [x] Update `src/adapters/types.ts`: remove Stop capability and Stop result
      fields; rename `testHook` to `testEntryHook`.
- [x] Update `src/adapters/shared.ts`: Entry-only wrapper installation and
      host field test; remove Stop protocol/template/loop execution.
- [x] Update Codex and Claude config builders/serializers/probes to register
      SessionStart only.
- [x] Update `src/adapters/installed-hooks.ts` to validate Entry wrapper and
      SessionStart registration only.
- [x] Delete `src/hooks/stop.ts` after all imports are removed.

## 3. Update commands and persisted field-test projection

- [x] Rename the public command to `tc agent test-entry-hook`; update help,
      errors, persisted record writes, capabilities display, and JSON output.
- [x] Replace `hookTests`/`HookTestRecord`/`enforced` with
      `entryHookTests`/`EntryHookTestRecord` and `ok`.
- [x] Update `tc init --agent` output and result to one Entry hook path.
- [x] Update `tc enable` to verify/report Entry only.

## 4. Update Watch and Diagnostics

- [x] Change Watch Runtime API/rendering/types to `entryHookTests` and remove
      enforcement wording.
- [x] Collapse diagnostics to Entry wrapper/registration/test/version checks.
- [x] Rename Watch-local Hook diagnostic codes to Entry-specific names.

## 5. Rewrite automated coverage

- [x] Remove Stop gate/script/loop tests and Stop branches from Adapter
      conformance, init, enable, agent, and field-test tests.
- [x] Preserve and strengthen Entry success/failure coverage for Codex and
      Claude, including real installed wrapper fixtures and unique active task.
- [x] Update Watch Runtime/Diagnostics and frontend renderer tests for the new
      persisted/API shape.
- [x] Add negative assertions that fresh configs, hook paths, capabilities,
      command output, and Watch output contain no Stop contract.

## 6. Synchronize status and historical documentation

- [x] Update README, roadmap, Task 07, migration runbook, and current handoffs:
      Stop is removed, not pending or a cutover gate.
- [x] Add supersession notes to dogfood/host-smoke/research where Stop results
      are historical; do not falsify the original samples.
- [x] Scan plans/examples for current-tense Stop claims and distinguish
      archived requirements from current product behavior.

## 7. Validation and review gates

- [x] Run targeted Hook/Adapter/CLI/Watch tests with a 60-second test timeout.
- [x] Run `pnpm check`.
- [x] Run `git diff --check`.
- [x] Run `pnpm smoke:watch`; if sandbox blocks localhost, rerun outside it.
- [x] Scan production code for `stop.ts`, `stop.sh`, `hooks.Stop`,
      `stopBlocked`, `loopGuard`, `enforced`, and the `"stop"` capability.
- [x] Review the diff for a no-op Stop fallback, duplicate persisted schemas,
      stale migration gates, or rewritten historical evidence.
- [x] Do not run paid Codex/Claude calls without separate user authorization;
      report that residual verification explicitly.

## Risky files / rollback points

- `src/adapters/shared.ts` and `src/adapters/types.ts` own the shared contract;
  update consumers together to avoid a temporary second source of truth.
- `src/hooks/shared.ts` and `src/watch/routes.ts` define the persisted/API
  shape; do not keep parallel `hookTests` and `entryHookTests` readers.
- Normative docs must change in the same task as code. Roll back the entire
  task if Entry field testing or fresh host registration regresses.
