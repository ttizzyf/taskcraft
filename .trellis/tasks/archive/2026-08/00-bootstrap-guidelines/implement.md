# Implementation Plan: Taskcraft Guideline Indexes

Implementation begins only after the user approves this plan.

## Steps

- [x] Create `.trellis/spec/taskcraft.md` as the canonical source-role
      index, using links and classifications only.
- [x] Replace `.trellis/spec/backend/index.md` and
      `.trellis/spec/frontend/index.md` with concise layer entry points that
      link to the canonical index and explicitly defer code conventions until
      real implementation evidence exists.
- [x] Delete the five generated backend leaf templates and six generated
      frontend leaf templates; do not create replacement coding-guideline files.
- [x] Confirm `.trellis/spec/guides/`, Taskcraft authoritative documents, and
      `development/plans/task-00-contract-baseline.md` are unchanged.
- [x] Review the final diff, finish the bootstrap task, and archive it only after
      its acceptance criteria pass.

## Validation

Run, in order:

```bash
python3 ./.trellis/scripts/get_context.py --mode packages
rg -n "To fill|To be filled|TODO: fill|placeholder" .trellis/spec/backend .trellis/spec/frontend
rg -n "AGENTS.md|development/(specs|contracts|plans|runbooks|research|prototypes)" .trellis/spec/taskcraft.md
python3 ./.trellis/scripts/task.py current --source
git diff --check
git diff -- .trellis/spec .trellis/tasks/00-bootstrap-guidelines
```

The placeholder search must return no matches. Local links and referenced paths
will also be resolved explicitly against the repository before completion.

## Review Gates

- Before editing `.trellis/spec/`: user approves this PRD, design, and plan.
- Before archive: verify the diff contains navigation and template removal only,
  with no copied product contract and no Task 00 implementation.

## Rollback Point

All execution changes are isolated to `.trellis/spec/`. If the reshaped index is
not consumable by Trellis, restore only the bootstrap execution diff and keep
the authoritative Taskcraft documents untouched.
