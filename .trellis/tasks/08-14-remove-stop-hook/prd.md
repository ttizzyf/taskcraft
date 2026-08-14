# Remove Stop Hook and adopt agent-driven continuation

## Goal

Remove Taskcraft's Stop Hook and its turn-level coercion so task continuity is
driven by durable Task Store facts, Node Brief/command-result `next`, the
Agent's own continuation judgment, typed `waiting`, and Entry Hook recovery.
Ending one Agent turn must not imply that the task is complete, failed, or
cancelled.

## Background and Confirmed Facts

- The user deliberately rejects Stop-based forced continuation: an unclear or
  infeasible objective can pressure an Agent into test weakening, hidden
  fallbacks, scope drift, or other invalid ways of satisfying “finish”.
- `development/specs/lifecycle.md` §7 already defines `waiting`, explicit
  blockers, user interruption, persisted `next`, and cross-session recovery.
  Those mechanisms remain sufficient after Stop is removed.
- Entry Hook is retained. It injects a compact breadcrumb only when there is a
  unique active task and remains the cross-session recovery mechanism.
- Stop currently spans runtime code (`src/hooks/stop.ts`), generated wrappers,
  Codex/Claude host registration, Adapter capability and field-test contracts,
  `tc enable`, Watch Runtime/Diagnostics, tests, and normative documentation.
- Fresh-install removal alone is incomplete: an existing project config can
  continue invoking `.taskcraft/hooks/stop.sh` after the runtime is deleted.
- Taskcraft is pre-cutover; Codex Stop has never passed the current real-host
  gate, while Claude Stop evidence is historical and must remain distinguishable
  from the new Entry-only product contract.
- Taskcraft has no production users or compatibility commitment yet. This task
  may make a clean breaking change: no old Stop registration migration, no
  compatibility alias, and no no-op Stop wrapper are required.

## Requirements

1. Remove the Stop gate implementation, managed `stop.sh` wrapper, and new
   Codex/Claude Stop registrations. Taskcraft must not block or intercept an
   Agent's normal end-of-turn behavior.
2. Preserve Entry Hook installation, trust/feature checks, breadcrumb
   injection, takeover `off|ask|always`, and unique-active-task preconditions.
3. Replace `tc agent test-hook` with the Entry-only command
   `tc agent test-entry-hook` without a compatibility alias. It must run the
   installed Entry wrapper through the real host, persist
   timestamp/version/result, and fail explicitly for missing registration,
   invalid path, disabled takeover, missing unique active task, Codex
   trust/feature failure, timeout, or missing breadcrumb. No Stop or loop-guard
   result may be required for success.
4. Remove Stop from Adapter capability types, CLI output, Watch Runtime, and
   Diagnostics. Entry verification must use one shared persisted result source
   and must not retain the misleading `enforced` label.
5. Rewrite the continuous-execution contract: an `active` task may outlive the
   current Agent turn; the Agent continues while the next step is clear and
   safe, enters typed `waiting` when input/decision/dependency is required, and
   relies on Entry recovery in a later turn or session.
6. Keep the five public task states, reducer/projector invariants, Node Brief,
   obligations, evidence, Review, observations, and SQLite schema unchanged.
   Only the pre-release config/Watch Hook-test projection changes to an
   Entry-specific shape.
7. Update normative specs, migration/runbook status, roadmap/handoffs, and
   historical smoke documents without rewriting old evidence as if Stop had
   never existed.
8. Preserve non-Taskcraft host hooks and unrelated user configuration.

## Out of Scope

- Adding `/goal`, a background scheduler, automatic model continuation, or a
  replacement turn-blocking mechanism.
- Removing Entry Hook or weakening explicit `waiting`, Review, obligation, and
  evidence gates.
- Reworking lifecycle levels, task states, Runtime observations, or Watch
  layout beyond fields and wording directly tied to Stop.
- Re-running paid Codex/Claude host calls during implementation unless the user
  separately authorizes them.

## Acceptance Criteria

- [x] A fresh `tc init --agent codex|claude` installs/registers Entry only and
      creates no managed Stop artifact or capability claim.
- [x] `tc enable off` verifies Entry silence without importing or executing a
      Stop gate; other modes describe Entry behavior only.
- [x] The public field-test result succeeds solely on verified real Entry
      breadcrumb injection and persists an Entry-specific result consumed by
      capabilities, Runtime, and Diagnostics.
- [x] `tc agent test-entry-hook` is the only field-test command; the old
      `test-hook` command and compatibility aliases are absent.
- [x] Missing/invalid Entry wrapper, registration, trust/feature gate, active
      breadcrumb, timeout, and host version drift have stable automated tests.
- [x] No production source imports `src/hooks/stop.ts`, writes a Stop
      registration, creates `stop.sh`, or reports Stop enforcement.
- [x] No migration or compatibility code is added for pre-release Stop
      registrations; the clean Entry-only contract is the sole current path.
- [x] Lifecycle/architecture/CLI/product specs consistently describe
      agent-driven continuation and Entry-based recovery; historical evidence
      remains explicitly historical.
- [x] Targeted tests, `pnpm check`, `git diff --check`, and final
      `pnpm smoke:watch` pass. Real-host tests are reported separately if not
      authorized.

## Notes

- This is a structural subtraction, not a Codex-only workaround. Claude and
  Codex must expose the same Entry-only product boundary.
