# Implement: Reducer and projector

## Checklist

1. `src/core/errors.ts`（扩充 store-transaction 骨架：`TC_TASK_ALREADY_CANCELLED`、
   `TC_TASK_LEVEL_UNSUPPORTED`、`TC_LIFECYCLE_RESULT_INVALID`、
   `TC_EVIDENCE_REF_INVALID`、`TC_REQUIRED_OBLIGATION_MISSING` 等）。
2. `src/core/lifecycle/l1.ts`：L1 图 + result schemas + evaluator 常量。
3. `src/core/command-result.ts`：`tc-command-result/v1` 构造器（ok/errors）。
4. `src/core/reducer.ts`：taskNew / run / runComplete / cancel + 失败 attempt
   语义（≤400 行，超出拆 `reducer/` 目录）。
5. `src/core/projector.ts`：project() + next 推导（≤400 行）。
6. `src/core/breadcrumb.ts`：按 `breadcrumb.schema.json` 构造。
7. fixtures：l1-pass / validation-missing / five-status / revision-conflict /
   transaction-rollback / cancel / retry-exhaustion。
8. tests：`tests/core/reducer.test.ts`、`tests/core/projector.test.ts`、
   `tests/core/breadcrumb.test.ts`（+ fixture helper
   `tests/helpers/load-fixture.ts`：fixture JSON → 临时 DB 事实导入）。
9. `pnpm check` 全绿 + `git diff --check`。

## Validation

```bash
pnpm check
git diff --check
```

## Review Gates

- fixtures 只增不改既有文件；storage.sql / schemas 不动。
- 任何与冻结合同冲突的语义 → 回 Plan 修正父 design，不改 contract。
- 每个文件 ≤ 400 有效行。

## Commit

`feat(core): add L1 reducer, projector and lifecycle graph`
→ `trellis-check` 审查 → `/trellis:finish-work` 归档。
