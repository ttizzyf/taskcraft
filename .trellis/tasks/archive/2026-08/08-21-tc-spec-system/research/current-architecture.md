# Current Architecture Evidence

## Confirmed Boundaries

- `src/commands/init.ts` currently initializes `.taskcraft/taskcraft.db` and
  optional host Entry Hooks. It does not create or register project Specs.
- `src/commands/helpers.ts` is the shared project-directory and command error
  boundary. Reducers receive structured inputs and do not read arbitrary
  project files.
- `src/core/reducer/task-new.ts` atomically inserts the task, initial lifecycle
  revision, graph, obligations and event. L1/L2/L3 compilers have distinct
  version identifiers.
- `src/core/reducer/run.ts#buildNodeBrief` reads only the current SQLite
  lifecycle and obligations. The current brief has no project context refs.
- `src/core/reducer/review-start.ts` creates the Review attempt/link/event but
  does not currently return a Review Node Brief.
- `src/core/lifecycle/l2.ts` Frame output owns objective/scope/acceptance;
  downstream Execute/Review cannot run until Frame is satisfied.
- `src/core/lifecycle/l3-schemas.ts` and `l3-accept-plan.ts` already compile an
  accepted Plan into a new immutable execution revision and real L1/L2 child
  tasks. Child planning provenance is normalized in SQLite.
- `migrations/0001_initial.sql` and `0002_l3_modular_tasks.sql` use normalized,
  append-only definition relations with foreign keys and immutable triggers.
- `src/core/doctor.ts` validates the Task Store; `src/commands/doctor.ts` owns
  filesystem-aware command diagnostics. Spec file validation belongs at the
  command/service boundary, not in the reducer.
- `src/watch/routes.ts` builds Watch DTOs from the same store query/projector
  model used by CLI surfaces.

## Design Consequences

1. Spec Markdown remains a Git-owned project file; SQLite stores references,
   digests and task adoption facts only.
2. Filesystem containment, Registry parsing and digest calculation need one
   shared `src/spec/` boundary. Reducers only accept already-resolved values.
3. Spec binding rows must be revision/node scoped and append-only so old
   revisions remain queryable without backfill.
4. L2 Frame can append immutable downstream bindings before Execute becomes
   runnable. L3 bindings must be materialized by accepted Plan transactions.
5. Existing compiler versions and old revisions cannot gain new required
   obligations retroactively.
