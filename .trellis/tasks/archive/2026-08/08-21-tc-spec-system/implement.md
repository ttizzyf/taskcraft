# Implementation Plan

## Preconditions

- Parent PRD/design approved by the user.
- Three non-recursive Trellis child tasks from `design.md` section 11 are
  created; each owns a focused PRD, design, implementation plan and acceptance
  criteria.
- Execute children in dependency order: Registry -> Lifecycle -> Delivery.
- Do not stage or overwrite unrelated worktree changes, including the earlier
  `.trellis/config.yaml` dispatch-mode change, in product commits by accident.

## Module 1: Registry And CLI Foundation

1. Add `development/contracts/spec-registry.schema.json` and contract fixtures.
2. Add a single `src/spec/` service for Registry loading, Ajv validation,
   project-realpath containment, readable-file checks, SHA-256 digests and
   path-based candidate resolution.
3. Extend `tc init` to create an empty Registry only when absent.
4. Add `tc spec list`, `check` and `resolve`; register them in `src/cli.ts` and
   reuse command-result/error rendering.
5. Add `TC_SPEC_*` error codes and focused unit/CLI tests, including malformed
   JSON, duplicate ids/path, symlink escape, missing file, domain authority,
   idempotent init and JSON/text same-source output.
6. Update product/architecture/CLI contracts for the Registry boundary.

Validation:

```bash
pnpm vitest run tests/spec tests/cli/spec.test.ts tests/cli/init.test.ts --testTimeout=60000
pnpm typecheck
pnpm lint
```

Rollback point: Registry/CLI changes are isolated and do not alter existing DB
schema or task behavior.

## Module 2: Lifecycle Binding And Inheritance

1. Add migration `0003_spec_system.sql` and synchronize
   `development/contracts/storage.sql` with binding/impact tables, constraints,
   indexes and immutable triggers.
2. Add binding query/write helpers with one normalized DTO used by reducer,
   CLI, Node Brief and Watch consumers.
3. Extend task creation input/CLI with resolved initial bindings and bump new
   lifecycle compiler versions without changing old stored revisions.
4. Extend L2 Frame and L3 Plan schemas/results with binding proposals; resolve
   Registry ids at the command boundary and write bindings atomically.
5. Materialize L3 parent/child bindings and provenance; include Spec sets in
   reusable-child contract equality.
6. Implement required/recommended drift evaluation and explicit
   `tc task spec refresh`, sharing replan primitives instead of duplicating L3
   revision logic.
7. Add store/reducer/projector tests for rollback, no backfill, old compiler
   compatibility, L1/L2/L3 single/modules, child inheritance/reuse and drift.

Validation:

```bash
pnpm vitest run tests/store tests/core/reducer.task-new.test.ts tests/core/reducer.run-complete.test.ts tests/core/reducer.l3-plan.test.ts tests/core/reducer.review-replan.test.ts --testTimeout=60000
pnpm typecheck
pnpm lint
```

Rollback point: migration is additive. Never edit applied migration 0001/0002
or delete newly written binding facts.

## Module 3: Delivery And Closure

1. Extend shared Node Brief DTO/rendering and adapter conformance with bound
   Specs; return a Review Node Brief from `review start`.
2. Add new Record result schemas, `spec-impact-recorded` obligation and reducer
   validation/materialization for `none | updated | candidate`.
3. Extend task show/rendering and Watch Task Detail/API/frontend with binding,
   drift and impact fields sourced from the shared query model.
4. Extend `tc doctor` and Watch diagnostics with Registry/binding/impact/L3
   provenance checks while treating old revisions as valid.
5. Add public CLI lifecycle tests for L1, L2, L3 single/modules, stale required
   Spec remediation, candidate domain rule and updated engineering Spec.
6. Synchronize README, architecture, lifecycle, CLI, product, storage contract,
   migration/cutover runbook and `.trellis/spec` implementation contracts.
7. Run final full-scope verification and inspect the diff for duplicate
   Registry parsing, hidden fallback, semantic claims TC cannot prove, old-task
   regressions and accidental business-rule promotion.

Validation:

```bash
pnpm test -- --testTimeout=60000
pnpm typecheck
pnpm lint
pnpm format:check
pnpm build
pnpm smoke:watch
pnpm check
```

Rollback point: host hooks and Entry breadcrumb stay unchanged. If UI delivery
fails, retain CLI/Node Brief facts and fix the shared Watch consumer rather
than creating a second Spec projection.

## Parent Integration Gate

- All child acceptance criteria pass and no child owns unresolved findings.
- Run `pnpm check` and `pnpm smoke:watch` from a clean build.
- Exercise one public CLI sample for L1, L2, L3 single and L3 modules using a
  real Git Spec file and the migrated SQLite Store.
- Verify an old pre-0003 Task completes without binding or Spec Impact.
- Verify current Registry deletion/change is visible and never mutates old
  SQLite facts.
- Review documentation authority: current engineering rules live in registered
  Git Specs; Task Store holds only adoption/history facts.

## Final Integration Validation

- Registry, Lifecycle and Delivery child tasks are completed and archived with
  no unresolved Review findings.
- `pnpm check` passed: 70 test files / 482 tests, typecheck, lint, format and a
  clean build.
- `pnpm smoke:watch` passed 6/6 desktop and mobile checks with local-listen
  permission. The restricted-sandbox `EPERM` run is not counted as evidence.
- Public CLI and migration integration passed 26/26 focused tests using real
  Git Markdown/Registry files and migrated SQLite stores. Coverage includes L1,
  L2, L3 single, L3 modules, pre-0003 completion and Registry drift/deletion.
- Independent `trellis-check` found no remaining implementation, test or
  documentation issue. Git remains the Spec body authority; SQLite stores only
  revision adoption, digest, provenance, evidence and Impact facts.
