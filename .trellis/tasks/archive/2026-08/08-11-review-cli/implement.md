# Implement: L2 review CLI slice

## Checklist

1. `src/commands/review-start.ts` / `review-pass.ts` / `review-changes.ts` /
   `review-replan.ts`；`src/cli.ts` 注册 `tc review` 组。
2. L2 闭环走通（level 2 建卡 → frame/execute/record 走既有 run/complete →
   review 走新命令）。
3. 可回放样本：`development/` 下 `l2-review-sample.md`（三条路径命令序列 +
   关键输出断言），临时目录真实执行验证。
4. tests/cli/review.test.ts：三路径闭环 + 历史可查询断言 + 退出码 + --json。
5. `pnpm check` 全绿 + `git diff --check`。

## Validation

```bash
pnpm check
git diff --check
node dist/cli.js review --help
```

## Review Gates

- 只消费 core/reducer/projector 接口；若发现 core 语义缺陷 → 报告主流程
  回 review-reducer 修复，不在渲染层打补丁。
- 文件 ≤ 400 有效行；不新增 npm 依赖。

## Commit

`feat(cli): add L2 review commands and sample`（或按内容拆 feat/test/docs）
→ `trellis-check` 审查 → `/trellis:finish-work` 归档。

## After This Phase

父任务 Phase C 集成验收：核对父 prd AC、更新 handoff 交接、roadmap 状态、
父任务归档。
