# Implement: L3 graph and reducer semantics

## Checklist

1. `src/core/lifecycle/l3.ts`（图 + schemas + obligations）。
2. `src/core/errors.ts` 扩充（TC_FACT_* 或复用 TC_TASK_INPUT_INVALID）。
3. `src/core/reducer/task-fact-add.ts` + `src/core/reducer.ts` 桶导出 +
   `taskNew` level 3。
4. `src/core/projector.ts`：feasibility gate、review satisfied by purpose、
   on-demand integration、reviewed-attempt 默认解析。
5. `tests/helpers/load-fixture.ts` 扩展 taskFacts 段；fixtures 8 个。
6. tests：tests/core/reducer.fact-add.test.ts、projector.l3.test.ts 等。
7. `pnpm check` 全绿 + `git diff --check`。

## Validation

```bash
pnpm check
git diff --check
```

## Commit

`feat(core): add L3 lifecycle, feasibility gate and task facts`（或按内容拆）
→ `trellis-check` → `/trellis:finish-work` 归档。
