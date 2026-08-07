# Bootstrap Taskcraft Guideline Indexes

## Goal

Make Trellis direct future Taskcraft development sessions to the repository's
existing authoritative documents without copying product contracts or
inventing backend or frontend coding conventions before production code
exists.

## Background

- `development/README.md` defines the repository's documentation authority
  order and says Trellis planning artifacts are not a second product contract.
- `development/runbooks/trellis.md` limits this bootstrap to indexing existing
  sources and removing or explicitly marking inapplicable generated templates.
- The repository currently contains product research, contracts, schemas, plans,
  and an interaction prototype, but no production implementation from which
  backend or frontend coding patterns can be inferred.
- Trellis inline development discovers `.trellis/spec/backend/index.md` and
  `.trellis/spec/frontend/index.md`, then follows the references they contain.
- The generated backend and frontend leaf files contain only placeholder text.

## Requirements

1. Provide one canonical Taskcraft source index under `.trellis/spec/`.
2. The index must identify source roles and authority, not reproduce product
   requirements, schemas, lifecycle rules, or implementation plans.
3. Keep backend and frontend `index.md` files as Trellis discovery entry points.
   Each entry point must state that no source-backed layer conventions exist yet
   and direct agents to the canonical Taskcraft source index.
4. Remove generated backend and frontend leaf templates that have no evidence in
   the current repository. Do not replace them with speculative guidance or code
   examples.
5. Classify the existing sources consistently with `development/README.md`:
   root `AGENTS.md` is the product-invariant and validation entry; `specs/` and
   `contracts/` are normative sources; `plans/` are stage inputs; `runbooks/`
   are development operations; `research/` and `prototypes/` are non-normative.
6. Leave `.trellis/spec/guides/` unchanged. This task owns the Taskcraft source
   index and generated layer placeholders, not Trellis's shared thinking guides.
7. Future layer-specific coding guidance may be added only after real source and
   tests provide stable examples.

## Acceptance Criteria

- [x] A future agent starting from either layer index can reach the same single
      Taskcraft source index.
- [x] The source index points to authoritative repository paths and explains
      their roles without copying their substantive contracts.
- [x] Backend and frontend indexes do not claim conventions unsupported by real
      code.
- [x] No generated placeholder leaf file remains under
      `.trellis/spec/backend/` or `.trellis/spec/frontend/`.
- [x] No Taskcraft product contract, schema, phase plan, production code, or
      `.trellis/spec/guides/` file is changed.
- [x] Repository diff checks and link/path checks pass, and the bootstrap task is
      still distinct from product Task 00.

## Out Of Scope

- Implementing `development/plans/task-00-contract-baseline.md` or creating its
  Trellis task.
- Changing Taskcraft product requirements, contracts, schemas, fixtures, plans,
  research, or prototypes.
- Defining directory, database, error-handling, logging, component, hook, state,
  type-safety, testing, or toolchain conventions before production code exists.
- Restructuring Trellis workflow, hooks, configuration, or shared thinking
  guides.
