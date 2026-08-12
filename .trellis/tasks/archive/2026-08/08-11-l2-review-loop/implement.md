# Implement: L2 tracked workflow and review feedback

## Execution Order

`review-reducer` → `review-cli` → 父任务集成验收。每个子任务独立 start / check /
commit / 归档；父任务最后做纵切验收。

## Ordered Checklist

### Phase A: review-reducer 子任务

1. `task.py start` 08-11-review-reducer。
2. `src/core/lifecycle/l2.ts`：L2 图（frame/execute/review/record + obligations +
   frame result schema），与 L1 共享 evaluator。
3. `src/core/reducer/` 新增 review-start / review-pass / review-changes /
   review-replan 四命令 + errors 扩充（TC_REVIEW_*、TC_REQUIRED_EVIDENCE_MISSING）。
4. `src/core/projector.ts`：按 node kind 生成 next（review start/pass 命令）；
   review 节点 satisfied/running 判定。
5. `taskNew` 支持 level 2（物化 L2 图）。
6. fixtures：l2-pass / review-changes-requested / review-replan-required /
   review-same-actor / review-unverified / review-missing-evidence。
7. 测试：review link/outcome/evidence 合同、三 outcome 事务（零写入、supersede
   原子性、revision 切换无部分事实）、projector next。
8. `pnpm check` 全绿 → 提交 → `trellis-check` → 归档。

### Phase B: review-cli 子任务

1. `task.py start` 08-11-review-cli。
2. `src/commands/` review-start / review-pass / review-changes / review-replan
   + `src/cli.ts` 注册。
3. L2 闭环：frame/execute/record 走既有 run/runComplete；review 走 review
   命令；level 2 建卡。
4. 可回放 L2 样本：真实命令序列记录（development/ 下文档或 fixture），覆盖
   passed / changes_requested / replan_required 三条路径，验证旧 attempt、
   finding、successor、revision 均可查询。
5. CLI 集成测试：L2 闭环到 done、changes/replan 回流、退出码、--json。
6. `pnpm check` 全绿 → 提交 → `trellis-check` → 归档。

### Phase C: 父任务集成验收

1. 临时目录端到端 smoke：L2 三路径（passed 到 done；changes_requested →
   successor execute → 再 review → done；replan_required → 新 revision →
   完成 → done）。
2. 核对父 prd.md Acceptance Criteria（含 supersede 原子性、历史可查询、
   `git diff --check`、`pnpm check`）。
3. 更新 `development/task-02-handoff.md` 为 Task 03 交接状态；roadmap 状态列
   更新 Task 03 完成。
4. 父任务归档。

## Validation Commands

```bash
pnpm check
git diff --check
node dist/cli.js --help
```

## Review Gates

- 每个子任务提交前：`pnpm check` 全绿 + `git diff --check` 干净 +
  `trellis-check` 通过。
- 冻结文件出现 diff 时停止回 Plan；review 语义与 trigger 冲突以 contract 为准。
- 文件 ≤ 400 有效行。

## Rollback Points

- Phase A 语义问题：回 Plan 修正 design，不改 contract。
- Phase B CLI 行为问题：只改 commands/ 与渲染。
- 任一阶段不可修复：回退最后一个稳定提交并报告。
