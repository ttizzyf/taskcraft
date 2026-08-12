# Implement: L3 CLI loop and sample

## Checklist

1. `src/commands/task-fact-add.ts` + `src/cli.ts` 注册。
2. L3 闭环真实走通（临时目录）：主路径 + feasibility changes 回流 +
   modifiedDeliverables → integration review 路径。
3. `development/l3-sample.md` 可回放样本（真实执行验证后固化）。
4. tests/cli/l3.test.ts（闭环/gate/回流/fact/退出码/--json）。
5. `pnpm check` 全绿 + `git diff --check`。

## Validation

```bash
pnpm check
git diff --check
node dist/cli.js task fact add --help
```

## Review Gates

- 只消费 core 接口；若发现 gate 语义缺陷 → 报告主流程回 l3-graph-reducer。
- 文件 ≤ 400 有效行；不新增 npm 依赖。

## Commit

`feat(cli): add task fact add and L3 CLI loop`（或按内容拆 feat/test/docs）
→ `trellis-check` → `/trellis:finish-work` 归档。

## After This Phase

父任务 Phase C 集成验收：核对父 prd AC、更新 handoff、roadmap、父归档。
