# Design: Taskcraft Guideline Indexes

## Boundary

The bootstrap will change only the Taskcraft-facing navigation surface under
`.trellis/spec/`:

- one canonical Taskcraft source index;
- the backend and frontend discovery indexes;
- removal of unused generated layer templates.

All product facts remain in their current authoritative files. The Trellis index
contains links and source classifications only.

## Index Shape

Create `.trellis/spec/taskcraft.md` as the single source registry. Keeping this
file at the spec root prevents Trellis from misclassifying `taskcraft` as a
third code layer. Both
`.trellis/spec/backend/index.md` and `.trellis/spec/frontend/index.md` remain
because `trellis-before-dev` discovers those layer paths in the current
single-repository configuration. They contain only:

- the current absence of source-backed conventions for that layer;
- a link to `../taskcraft.md`;
- the evidence threshold for adding future layer guidance.

This avoids duplicating the documentation hierarchy across two layer indexes
while preserving Trellis's existing discovery contract.

## Source Classification

The canonical index will route agents by role:

| Source | Role |
| --- | --- |
| `/AGENTS.md` | Product invariants and validation-order entry |
| `/development/specs/` | Normative product, lifecycle, architecture, and CLI specifications |
| `/development/contracts/` | Executable SQL, schema, and fixture contracts |
| `/development/plans/` | Ordered stage inputs that do not override contracts |
| `/development/runbooks/` | Development operations, not runtime design |
| `/development/research/` | Time-bound evidence, non-normative until promoted |
| `/development/prototypes/` | Interaction reference, non-normative |

The index will link to directories or existing entry documents rather than
summarizing their substantive rules.

## Template Removal

Delete all generated backend and frontend leaf templates because every one is
placeholder-only and none is backed by production source. Keeping empty files
would imply unfinished requirements and invite future agents to invent rules.
The two layer `index.md` files remain as explicit, truthful empty-layer markers.

`.trellis/spec/guides/` is unchanged because it is a separate shared Trellis
surface and is not needed to establish the Taskcraft source index.

## Compatibility And Rollback

The design preserves the layer index paths consumed by `trellis-before-dev`, so
future inline sessions retain a valid entry point. Rollback is confined to the
new/updated/deleted files under `.trellis/spec/`; authoritative Taskcraft
documents are never migrated or rewritten.

The main risk is a broken relative link after reshaping the tree. Verification
therefore checks every referenced local path and rereads both layer indexes from
the same discovery flow used by future sessions.
