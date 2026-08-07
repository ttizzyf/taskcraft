# 任务 05：L3 Feasibility 与 Integrate

## 目标

实现复杂任务的基础合同：主 Agent 计划、独立 Feasibility Review、按依赖执行与 Delivery Review、必要时 Integrate，并保留可追溯的 Task facts 和 evidence。

## 依赖

- 任务 04 完成。
- Taskcraft L1/L2 已通过真实样本；正式切换前，本阶段仍由 Trellis 作为唯一开发任务系统管理。
- Review actor constraint、probe 安全边界和 L3 graph contract 已冻结。

## 必读输入

- `development/specs/lifecycle.md` 的 L3、Feasibility Review 和编排章节
- `development/specs/architecture.md`
- `development/research/host-feasibility.md` 的 P1/L3 Gates
- `development/contracts/storage.sql`

## 范围

1. `frame -> plan -> feasibility review -> execute -> delivery review -> integrate -> record` 基础 L3 图。
2. Feasibility Reviewer 的用户意图覆盖、阻断假设探测、拆分/依赖/验证/集成检查。
3. append-only Task facts 与 evidence。
4. Plan successor、再次 Review、风险接受和 waiting(needs_decision/input)。
5. child、依赖、owner、result 和 integration input 查询。
6. 串行和 manual-attach 基础执行；并行只在写入范围与 owner 明确时开放。
7. Integrate 修改交付物时触发 integration Review。

## 交付物

- L3 compiler/interpreter 所需的最小实现。
- feasibility/delivery/integration Review purpose 全路径。
- probe、过期 fact、等待授权、两个 child、冲突和 stale fixtures。
- 一个真实 L3 串行或 manual-attach 样本。

## 验收标准

- 当前 Plan 未通过 Feasibility Review 时 Execute 不可 runnable。
- advisory finding 不阻止计划，blocking finding 有确定处理路径。
- 有副作用、付费、凭据或高风险权限的 probe 必须等待用户。
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
3. Adapter actor constraint conformance。
4. 真实 L3 生命周期样本。

## 后续启动提示

任务标题：`Implement L3 feasibility review and integration`

开发过程仍由 Trellis 管理，可用已实现的 Taskcraft L2 fixture 作为旁路 smoke，但不能为同一活动工作再创建 tc task。规划和独立 Review 必须由不同 Agent instance 完成；实现前先用宿主原生 research/reviewer 对 probe 安全模型和 graph gate 做压力测试，并把结果登记为 Taskcraft 测试 evidence。
