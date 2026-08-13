# Implement L3 feasibility review and integration

## Goal

实现复杂任务的基础合同：`frame -> plan -> feasibility review -> execute ->
delivery review -> integrate -> record` 闭环，Feasibility Review gate、
append-only Task facts、多分支依赖与 Integrate 触发 integration Review。
在同一 reducer/projector 上增量扩展，不预建平行状态机。

## Background

- 来源需求是 `development/plans/task-05-l3.md`。
- Task 01-04 已完成：L1/L2 内核、review 命令（purpose 分支 + storage.sql
  trigger 已支持 feasibility→plan / integration→integrate）、adapter、
  `task_02/03/04-handoff.md` 决策适用。
- 已冻结且不得改动：storage.sql、schemas、既有 fixtures、specs/、plans/。
- 用户已确认：父 + 2 子任务（l3-graph-reducer / l3-cli-sample）。

## Requirements

### REQ-01. L3 Built-in Graph

静态定义 L3 图：frame-1 → plan-1 → review-plan-1（feasibility）→ execute-1 →
review-execute-1（delivery）→ integrate-1 → review-integrate-1（integration，
按需）→ record-1。obligations：frame/execute/delivery 沿用 L2 模式；新增
plan 的 plan-completed（plan result 结构校验）、feasibility 的
intent-coverage + blocking-assumptions-probed + decomposition-accepted、
integration 的 integration-completed。`task new --level 3` 物化 L3 图；
L1/L2 不变。

### REQ-02. Feasibility Gate

**Execute 不可 runnable 直到当前 Plan attempt 的 Feasibility Review
passed**（lifecycle.md §9.1 唯一规则源）：projector 的 execute-1 入边依赖
review-plan-1 satisfied；`review --purpose feasibility --reviewed-attempt
<plan-attempt>` 审核 plan attempt（trigger 已强制 purpose↔kind 匹配）。
新 Plan（replan 或新 plan attempt）必须重新经过 Feasibility Review。

### REQ-03. Review 回流扩展

- feasibility `changes_requested` → 被审核 node kind（plan）的 successor
  attempt；`replan_required` → 新 lifecycle revision。
- 第二次 feasibility 仍 blocking → 主 Agent 必须选择：再修订、记录并接受
  风险（advisory 化或显式 record），或 `waiting(needs_decision)`。
- delivery/integration 回流沿用 Task 03 语义（successor / replan）。

### REQ-04. Task Facts & Evidence

`task fact add`：append-only 写 task_facts（category=intent|probe|
constraint|assumption|dependency|environment、subject、value_json、
source_attempt_id、evidence_id 可选）+ 审计 event。`constraint` fact 记录
用户非敏感决定；secret 永不落库（spec 边界）。

### REQ-05. Waiting & Blockers

Feasibility 检查需要付费/副作用/新凭据/高风险权限时 → 主 Agent 先
`waiting(needs_decision|needs_input)`（open blocker），用户回答后写
constraint fact 并 resume。reducer/projector 的 blocker 语义沿用（retry
exhaustion 已有）。

### REQ-06. Child / Dependency / Owner 查询

query model 补充：plan 的 child 关系、依赖边、owner（attempt actor）、
result 与 integration input 的只读查询（供 CLI/后续 Watch 消费）。

### REQ-07. Non-goals

- 不实现自动 worktree/merge/模型选择/代码插件节点。
- 不以并行能力作为完成条件（L3 串行或 manual-attach）。
- 不为活动工作双写 tc task（Trellis 仍是开发任务系统）。

## Acceptance Criteria

- [ ] 当前 Plan 未过 Feasibility Review 时 Execute 不可 runnable。
- [ ] advisory finding 不阻止计划；blocking finding 有确定处理路径。
- [ ] 有副作用/付费/新凭据/高风险权限的检查必须先等待用户决定。
- [ ] 新 Plan 必须重新经过 Feasibility Review。
- [ ] 多分支 required obligations 未满足前 Integrate 不可运行。
- [ ] 旧 revision、attempt、finding、fact、evidence 始终可引用。
- [ ] 新增文件有效行 ≤ 400；`pnpm check` 全绿；`git diff --check` 干净。

## Child Task Map

| 子任务 | 交付物 | 独立可检查点 |
| --- | --- | --- |
| `l3-graph-reducer` | L3 图、feasibility gate、task fact add、integration 语义、fixtures、核心测试 | Execute gate；fact append-only；多分支 Integrate 门 |
| `l3-cli-sample` | task fact add CLI、L3 CLI 闭环、可回放 L3 样本、CLI 测试 | L3 真实闭环；feasibility 回流；integration 路径 |

依赖顺序：`l3-graph-reducer` → `l3-cli-sample`；父任务负责接口一致性与最终
纵切验收。

## Notes

- 规划从真实 L3 路径反推：先定 feasibility gate 与多分支 Integrate 门的不变
  量，再拆实现。
- 子任务在各自 prd/design/implement 中细化；本文件是源需求集。
