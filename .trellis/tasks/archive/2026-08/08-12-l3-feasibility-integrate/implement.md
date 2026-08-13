# Implement: L3 feasibility review and integration

## Execution Order

`l3-graph-reducer` → `l3-cli-sample` → 父任务集成验收。每个子任务独立
start / check / commit / 归档。

## Ordered Checklist

### Phase A: l3-graph-reducer 子任务

1. `task.py start` 08-12-l3-graph-reducer。
2. `src/core/lifecycle/l3.ts`：L3 图 + plan/integrate result schema + obligations。
3. `src/core/reducer/`：task-fact-add.ts（+ errors 扩充）。
4. `src/core/projector.ts`：feasibility gate、review satisfied 按 purpose、
   on-demand integration review 判定、waiting(needs_decision) 投影。
5. `taskNew` 支持 level 3；review 四命令的 reviewed-attempt 默认解析扩展。
6. fixtures 8 个 + load-fixture 扩展（taskFacts 段）。
7. 测试：feasibility gate、fact append-only、integration 门、waiting、CAS。
8. `pnpm check` 全绿 → 提交 → `trellis-check` → 归档。

### Phase B: l3-cli-sample 子任务

1. `task.py start` 08-12-l3-cli-sample。
2. `src/commands/task-fact-add.ts` + cli.ts 注册。
3. L3 CLI 闭环（cli.md §4 L3 示例）真实走通；feasibility changes 回流。
4. `development/l3-sample.md` 可回放样本。
5. CLI 集成测试 + 退出码 + --json 同源。
6. `pnpm check` 全绿 → 提交 → `trellis-check` → 归档。

### Phase C: 父任务集成验收

1. 临时目录端到端 smoke：L3 主路径到 done + feasibility 回流。
2. 核对父 prd.md AC 逐条。
3. 更新 `task-04-handoff.md` 为 Task 05 交接；roadmap 更新。
4. 父任务归档。

## Validation Commands

```bash
pnpm check
git diff --check
node dist/cli.js --help
```

## Review Gates

- 每子任务提交前：pnpm check 全绿 + git diff --check 干净 + trellis-check。
- feasibility gate 与 lifecycle.md §9.1 冲突时以 spec 为准，回 Plan 修正。
- 冻结文件出现 diff 时停止。

## Rollback Points

- Phase A gate 语义问题：回 Plan 修正 design。
- Phase B CLI 问题：只改 commands/。
