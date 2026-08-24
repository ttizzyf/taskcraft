# Taskcraft Spec System Design

## 1. Problem And Invariants

Taskcraft can currently recover task execution facts but cannot tell an Agent
which project engineering contracts apply to a node. The solution must add
project knowledge without turning SQLite into a Markdown database or creating
a Trellis-compatible second workflow.

The design preserves these invariants:

1. Git-owned Spec files are the current project engineering truth.
2. SQLite is the sole writable Task Store and records only task adoption facts.
3. Command/service code resolves filesystem inputs; reducers perform validated
   transactional writes and never discover files themselves.
4. Lifecycle revision and node ids remain the task contract boundary.
5. Historical Task/revision rows are never backfilled with inferred Spec facts.
6. Business/domain rules are optional and require explicit authority; code
   observation alone cannot create business truth.
7. Taskcraft still does not dispatch, stop or schedule subagents.

## 2. Chosen Architecture

Use a hybrid model:

```text
.taskcraft/spec/index.json + Git Markdown
              |
              v
      Spec Registry service
              |
       resolved id/path/digest
              v
 SQLite lifecycle_spec_bindings
              |
       Node Brief / Review / Watch
              |
              v
       record specImpact result
```

This keeps the useful Trellis loop (select, load, comply, review, promote) but
uses Taskcraft's lifecycle and Node Brief rather than `implement.jsonl` and
`check.jsonl`.

Rejected alternatives:

- **Copy Trellis directly**: couples Spec delivery to a particular subagent
  workflow and creates files outside Taskcraft's lifecycle contract.
- **Store Spec bodies in SQLite**: duplicates Git content, makes review/diff
  awkward and creates two writable truth sources.
- **Let Node Brief search the repository dynamically**: makes the same task
  nondeterministic and moves semantic selection into a projector.

## 3. Registry Contract

The fixed entry is `.taskcraft/spec/index.json`:

```json
{
  "schemaVersion": "tc-spec-registry/v1",
  "specs": [
    {
      "id": "engineering.payment",
      "kind": "engineering",
      "path": "docs/engineering/payment.md",
      "summary": "Payment integration contracts",
      "appliesTo": ["src/payment/**"],
      "status": "active"
    }
  ]
}
```

Rules:

- `id` is stable and unique. A used id is deprecated, not silently reused.
- `kind` is `engineering | domain`.
- `path` is repository-relative, resolves inside the project realpath and
  names a readable regular file. Symlink escape is rejected.
- `appliesTo` contains repository-relative patterns used only for candidate
  discovery. A match never auto-binds a Spec.
- `status` is `active | deprecated`; new bindings require `active`.
- A `domain` entry additionally requires a non-empty `authority` reference.
- Duplicate active paths, unknown fields, invalid JSON and missing files fail
  explicitly.

`tc init` creates an empty schema-valid Registry only when it is absent. It
never overwrites an existing Registry or Spec body. Existing project docs can
be registered by path; migration into `.taskcraft/spec/` is optional.

The first public read-only commands are:

```text
tc spec list
tc spec check
tc spec resolve --path <repo-relative-path> [--path ...]
```

`resolve` returns candidates. Selection remains an Agent planning decision.

## 4. Store Contract

Migration `0003_spec_system.sql` adds two append-only fact sets.

### 4.1 lifecycle_spec_bindings

Each row records:

- target task, lifecycle revision and node;
- `spec_id`, `kind`, repository-relative path and SHA-256 digest;
- duty `required | recommended`;
- source kind `task_create | frame | accepted_plan | inherited_plan | refresh`;
- optional source task/attempt provenance;
- creation actor/time.

Primary identity is target task/revision/node/spec id. Foreign keys bind the
row to the exact lifecycle node and, when present, source attempt. Update and
delete are forbidden.

The Registry is intentionally not copied into SQLite. The binding snapshots
only the exact identity/path/digest adopted by that revision/node.

### 4.2 spec_impact_results

One immutable row per completed Record attempt stores:

- `none`: reason why no reusable rule changed;
- `updated`: affected Spec ids plus current path/digest and evidence refs;
- `candidate`: proposed engineering/domain rule and required owner decision.

The typed details remain schema-validated JSON because the three outcomes have
different payloads. The row references the exact Record attempt and revision.

## 5. Lifecycle Selection

### 5.1 Initial planning context

`tc task new` accepts optional structured `--specs <json|@path|@->`. The
command resolves active Registry ids before calling the reducer.

- L1: initial bindings target Execute and Record.
- L2: initial bindings target Frame.
- L3: initial bindings target Frame, Plan and Feasibility Review.

An empty list is valid. Taskcraft does not manufacture placeholder Specs.

### 5.2 L2 Frame

The new L2 Frame result requires `specBindings`, which may be empty. In the
same transaction that finishes Frame, resolved rows are appended for Execute,
Delivery Review and Record. No downstream attempt can exist yet, so the
selected delivery context is stable before execution begins.

### 5.3 L3 Plan

The L3 Plan result adds:

- `executionSpecs` for parent single/integration work;
- `specBindings` on every module proposal.

Feasibility pass resolves and validates every id before writing. The accepted
Plan transaction writes bindings into the new parent execution revision and
new child execution-only revisions. Child bindings retain parent Plan attempt
provenance and are not independently replanned.

Reusable children must match the proposed Spec id/duty set in addition to the
existing title/level/objective/scope/acceptance/non-goal contract.

### 5.4 Drift

Before creating an Execute or Review attempt, the command service revalidates
every required binding against the current Registry/path/digest. Any mismatch
fails before the attempt transaction with `TC_SPEC_BINDING_STALE`.

`tc task spec refresh <task> --reason <text>` creates a new lifecycle revision
with current confirmed bindings; it never updates old rows. For a modular L3
root or inherited child, refresh routes to a new parent planning revision,
marks old child memberships `not_required` without cancellation and returns
the parent Plan next. This is the same historical rule as contract replan.

Recommended binding drift is visible in Node Brief/Watch but does not block an
attempt. Required drift always blocks until explicit refresh/replan.

## 6. Node Brief And Review

`NodeBrief` gains `specs[]` entries containing id, kind, duty, path and bound
digest. Both host adapters render the same DTO.

- Execute briefs tell the Agent which exact files are required/recommended.
- Review start returns a Review Node Brief built from the Review node bindings
  and the reviewed attempt context.
- Taskcraft records references and evidence; it does not claim to prove that
  the model understood the Markdown.

Node Brief schema/version changes are explicit and adapter conformance tests
must cover Codex and Claude output equality.

## 7. Finish Contract

New compiler versions add a required `spec-impact-recorded` obligation to the
Record node and extend the Record result schema with `specImpact`.

- `none` requires a reason.
- `updated` requires active Registry entries, current digests and evidence
  references owned by the task.
- `candidate` records a proposed rule but does not modify the Registry or bind
  it as current truth. Domain discoveries use this outcome until a user-owned
  authority confirms and edits the Git Spec.

Old compiler versions retain their stored output schemas and obligations, so
existing tasks finish under their original contract.

## 8. Query, Watch And Doctor

One store query returns revision/node bindings and Spec Impact. CLI `task show`,
Node Brief and Watch consume that query; they do not parse Registry metadata
independently.

Watch Task Detail adds an unframed Spec section with current bindings, duties,
drift state and final impact. Board status remains unchanged.

`tc doctor` adds checks for:

- Registry schema, unique ids/paths, containment and file readability;
- required domain authority;
- binding node/source foreign references and immutable rows;
- binding path/kind/digest consistency for current revisions;
- inherited L3 binding provenance and reusable-child equality;
- new compiler revisions carrying the required Spec Impact obligation/result.

Old revisions without bindings are valid by construction.

## 9. Error Contract

Add stable errors under a `TC_SPEC_*` family:

- `TC_SPEC_REGISTRY_INVALID`
- `TC_SPEC_NOT_FOUND`
- `TC_SPEC_PATH_INVALID`
- `TC_SPEC_BINDING_INVALID`
- `TC_SPEC_BINDING_STALE`
- `TC_SPEC_IMPACT_INVALID`

Every failure includes problem, impact and one executable remediation. File or
Registry failures happen before reducer writes; reducer validation failures
roll back the complete transaction.

## 10. Compatibility, Rollout And Rollback

- No migration backfill. Migration 0003 only creates empty tables/triggers.
- New compiler versions opt new Task/revisions into Spec Impact and bindings.
- Old revisions remain readable and completable without Spec files.
- `tc init` Registry creation is write-if-absent and separately testable.
- Rollback stops creating new compiler revisions but never deletes bindings or
  impact rows. Git can revert Registry/Spec edits while SQLite history remains
  auditable; required drift will surface rather than be hidden.

## 11. Module Plan

The parent task owns this source requirement set and final integration review.
Implementation is split once, without nested children:

1. **Registry and CLI foundation**: schema, resolver, safe paths, init,
   `spec list/check/resolve`, focused tests.
2. **Lifecycle binding and inheritance**: migration, queries, L1/L2/L3 binding,
   refresh/replan and transaction tests.
3. **Delivery and closure**: Node Brief/Review, Spec Impact, doctor, Watch,
   adapter/CLI/full lifecycle tests and contract docs.

Module 2 depends on Module 1 contracts. Module 3 depends on Modules 1 and 2.
The parent performs final cross-module validation and documentation review.
