# ADR 0010：L3 模块化父子任务与单层执行图

## 状态

已接受，2026-08-17。

## 背景

旧 `tc-l3/1` 虽然在 Plan 中出现 `children`，但最多只有一个信息性条目；运行时
仍是父任务上的单个 execute。child 没有自己的状态、Attempt、Review、
waiting/resume、evidence 或 CAS，Integrate 也只接受 Agent 自报字符串。这让
“复杂任务拆分”停留在文档层，无法可靠恢复、重规划或审计。

直接把多个 execute 节点塞进父任务会让所有模块共享一个 Task revision，并使
waiting、Review、重试和重规划相互耦合；照搬 KP Board/角色链又会制造 SQLite
之外的第二状态源。

## 决定

- L3 使用两个连续、不可变的 lifecycle revisions：
  `frame -> plan -> feasibility review` planning revision，以及 Review 通过后创建的
  execution revision。
- Plan 明确选择 `modules | single`。`modules` 至少两个可独立验收模块；`single`
  必须记录 attempted split 与失败原因。
- `modules` 的 Feasibility pass 在一个事务内创建父 execution revision、真实 L1/L2
  children、acceptance anchors、coverage、显式 dependencies、validation owner 和
  inherited planning provenance。任一步失败全部回滚。
- child 使用 execution-only graph，从 execute 开始；父 Plan 是唯一规划来源，不
  伪造 Frame/Plan host Attempt。任务树永久限制为一层，L3 child 禁止。
- 父子关系不表达依赖。scope、共享锚点和共享验证是协调提示，只有显式
  `dependsOn` 阻塞 runnable。Taskcraft 返回完整 `runnableWorkItems`，但不调度或
  停止宿主 subagent。
- replan 追加 `not_required` membership，旧 task/Attempt/Evidence 不删除。新 Plan
  只有在 child 属于同一父任务且合同完全一致时，才可用 `reuseTaskId` 显式复用。
- 父任务取消不级联；存在未完成 required child 时拒绝取消。Integrate 必须引用
  当前 required child 的精确 task revision 与所属 evidence。

## 结果

父 L3 能聚合一层 child 的五状态并在全部 required children done 后解锁 Integrate。
父和正在运行的 child 可以同时 active，因此 Entry 只在 root tasks 中选择唯一锚点；
breadcrumb 锚定父任务，确定性 next 可以指向 child。

代价是 Feasibility pass 事务和 Projector 查询更复杂，doctor 需要额外检查层级、
coverage、dependency cycle 和 inherited provenance。旧 `tc-l3/1` facts 保持只读
可查询，新任务与 replan 使用 `tc-l3/2`。

## 拒绝的方案

1. 父任务动态增加多个 execute：无法获得独立 Task 状态与 CAS。
2. Agent 手工逐个建 child：Plan 与真实 Task 会漂移，且无法原子回滚。
3. 所有 L3 强制至少两个 child：会把原子高风险交付物拆成形式主义步骤。
4. 递归 L3：与 inherited planning、低摩擦和一层 Projector 边界冲突。
5. Taskcraft 并发调度器：越过“保存事实、校验合同、给出 next”的产品边界。

