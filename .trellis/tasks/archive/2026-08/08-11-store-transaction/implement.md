# Implement: Store and transaction layer

## Checklist

1. `src/core/errors.ts`：TaskcraftError 基类（code/problem/impact/
   remediation）+ 本层用到的 code 常量（`TC_STORE_TRANSACTION_FAILED`、
   `TC_REVISION_CONFLICT`、`TC_TASK_NOT_FOUND`）。
2. `src/store/transaction.ts`：`withTransaction`（见 design.md）。
3. `src/store/revision-guard.ts`：`checkRevision` + `TaskSnapshot` 类型。
4. `src/store/query.ts`：只读查询函数清单（见 design.md）。
5. `tests/store/transaction.test.ts`、`tests/store/revision-guard.test.ts`、
   `tests/store/query.test.ts`。
6. `pnpm check` 全绿 + `git diff --check`。

## Validation

```bash
pnpm check
git diff --check
```

## Commit

`feat(store): add transaction wrapper, revision CAS guard and query model`
→ `trellis-check` 子代理审查 → `/trellis:finish-work` 归档本子任务。

## Notes

- 不改 `database.ts` / `migrations.ts`；CAS 与事务由 reducer 组合调用。
- 新增文件有效行 ≤ 400，超出即拆。
