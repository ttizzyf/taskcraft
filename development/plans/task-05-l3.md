# 任务 05：L3 Feasibility 与 Integrate

## 目标

实现复杂任务的基础合同：计划、Feasibility Review、按依赖执行与 Delivery Review、
必要时 Integrate，并保留可追溯的 Task facts 和 evidence。

## 依赖

- 任务 04 完成。
- Taskcraft L1/L2 已通过真实样本；正式切换前，本阶段仍由 Trellis 作为唯一开发任务系统管理。
- Review 独立性披露、Agent 工具边界和 L3 graph contract 已冻结。

## 必读输入

- `development/specs/lifecycle.md` 的 L3、Feasibility Review 和编排章节
- `development/specs/architecture.md`
- `development/research/host-feasibility.md` 的 P1/L3 Gates
- `development/contracts/storage.sql`

## 范围

1. `frame -> plan -> feasibility review -> execute -> delivery review -> integrate -> record` 基础 L3 图。
2. Feasibility Review 的用户意图覆盖、阻断假设检查、拆分/依赖/验证/集成检查。
3. append-only Task facts 与 evidence；用户非敏感决定复用 `constraint` fact，
   secret 不落库。
4. Plan successor、再次 Review、风险接受和 waiting(needs_decision/input)。
5. child、依赖、owner、result 和 integration input 查询。
6. Node Brief 给出可选派发说明；当前 Agent 决定自行执行或使用宿主 subagent。
7. Integrate 修改交付物时触发 integration Review。

## 交付物

- L3 compiler/interpreter 所需的最小实现。
- feasibility/delivery/integration Review purpose 全路径。
- probe、过期 fact、等待用户决定、两个 child、冲突和 stale fixtures。
- 一个真实 L3 串行或 manual-attach 样本。

## 验收标准

- 当前 Plan 未通过 Feasibility Review 时 Execute 不可 runnable。
- advisory finding 不阻止计划，blocking finding 有确定处理路径。
- 有副作用、付费、新凭据或高风险权限的检查必须等待用户决定。
- 新 Plan 必须重新经过 Feasibility Review。
- 多分支 required obligations 未满足前 Integrate 不可运行。
- 旧 revision、attempt、finding、fact 和 evidence 始终可引用。

## 非目标

- 不实现自动 worktree、自动 merge 或模型选择。
- 不实现任意代码插件节点。
- 不以并行能力作为基础 L3 完成条件。

## 验证

1. Lifecycle/Schema 合同测试。
2. Feasibility 与 revision reducer 测试。
3. Adapter 独立性披露 conformance。
4. 真实 L3 生命周期样本。

## 后续启动提示

任务标题：`Implement L3 feasibility review and integration`

开发过程仍由 Trellis 管理，可用已实现的 Taskcraft L2 fixture 作为旁路 smoke，但
不能为同一活动工作再创建 tc task。有独立 reviewer 时优先使用；没有时当前 Agent
自审并记录 `same-actor`。实现前用宿主已有工具检查关键 graph gate，并把结果登记
为 Taskcraft 测试 evidence；Taskcraft 不提供 probe runner。
