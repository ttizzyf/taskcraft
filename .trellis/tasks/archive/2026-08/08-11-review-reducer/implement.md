# Implement: L2 review reducer semantics

## Checklist

1. `src/core/lifecycle/l2.ts`：L2 图 + frame result schema + obligations
   （复用 l1.ts 的 evaluator 模式）。
2. `src/core/errors.ts`：追加 TC_REVIEW_* 与 TC_REQUIRED_EVIDENCE_MISSING。
3. `src/core/reducer/`：review-start.ts / review-pass.ts / review-changes.ts /
   review-replan.ts + shared（review link 校验、finding 写入、supersede 辅助）；
   `src/core/reducer.ts` 桶导出四命令；`taskNew` 支持 level 2。
4. `src/core/projector.ts`：next 按 node kind（review start/pass 命令）；
   review satisfied/running 判定。
5. fixtures：l2-pass / review-changes-requested / review-replan-required /
   review-same-actor / review-unverified / review-missing-evidence。
6. tests：tests/core/reducer.review-*.test.ts、projector 扩展用例。
7. `pnpm check` 全绿 + `git diff --check`。

## Validation

```bash
pnpm check
git diff --check
```

## Review Gates

- review 语义与 storage.sql trigger 冲突时以 contract 为准（Task 02 先例）。
- 文件 ≤ 400 有效行；不新增 npm 依赖。

## Commit

`feat(core): add L2 lifecycle and review reducer commands`（或按内容拆
`feat(core)` / `test(core)` / `feat(contracts)`）→ `trellis-check` 审查 →
`/trellis:finish-work` 归档。
