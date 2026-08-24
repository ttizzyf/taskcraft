# Taskcraft Spec 真相源与生命周期绑定

## Goal

为 Taskcraft 增加项目级工程 Spec 机制，使 Git 中的当前工程规范能够被任务按
lifecycle revision 选择、由 Execute/Review Node Brief 按需交付，并在任务收口时
显式判断是否需要更新。Taskcraft 只管理规范的发现、引用、版本关联和审计，不复制
规范正文，也不把 Agent 从代码观察到的行为自动升级为业务真相。

## Background

- 当前 Task Store 只保存任务内容、lifecycle definition、runtime facts、Review、
  evidence、blocker 和 event；项目工程规范没有 Taskcraft 自有入口。
- 当前 Node Brief 只包含任务、节点、目标、procedure、obligations、结果 Schema 和
  登记命令，没有项目 Spec 引用。
- Taskcraft 不启动或调度 subagent，因此不能照搬 Trellis 的
  `implement.jsonl` / `check.jsonl` 交接方式。
- L1 直接进入 Execute；L2 先 Frame；L3 先 Frame/Plan/Feasibility Review，并可将
  accepted modules 物化为一层真实 L1/L2 child。
- Spec 正文必须是 Git 可审阅的项目文件；SQLite 只能保存稳定引用和任务实际采用的
  版本信息，避免第二份规范正文。

## Requirements

### R1. 项目 Spec Registry

- 项目具有一个 Taskcraft 管理的结构化 Spec Registry，作为规范发现的唯一入口。
- Registry 条目至少包含稳定 `id`、`kind`、正文 `path` 和适用范围；正文可以位于
  `.taskcraft/spec/`，也可以引用仓库已有的权威文档。
- `engineering` Spec 默认支持 Agent 辅助维护；`domain` / 业务 Spec 为项目可选能力，
  没有用户确认或明确权威来源时不得由 Agent 自动创建或改写。
- Spec 正文不进入 SQLite；Registry 和正文均由 Git 保存和审阅。

### R2. Revision-scoped Spec Binding

- Taskcraft 将任务实际采用的 Spec 以稳定 id、路径和内容摘要绑定到 lifecycle
  revision/node；绑定是定义事实并保持可审计。
- L1 在进入 Execute 前完成适用 Spec 的选择；L2 在 Frame 后形成 Execute/Review
  绑定；L3 Plan 为 parent/module 选择 Spec，modules child 继承 accepted Plan 的绑定，
  不重新规划。
- Agent 对候选 Spec 做最终语义确认；Taskcraft 可以按 scope/path 提供候选，但不得
  猜测业务含义或自行生成规范结论。

### R3. Node Brief 与 Review 同源

- Execute Node Brief 返回该节点的 required/recommended Spec 引用和可读取路径。
- Review Node Brief 使用当前 revision 的同一组 Spec 绑定，并明确检查适用合同、
  修改范围和验证要求。
- 当前 Agent 自行执行或使用宿主 subagent 时都消费同一 Node Brief；不增加 Taskcraft
  派发实体，也不生成 Trellis 风格的 JSONL 中转文件。

### R4. Spec 漂移与失败可见性

- Registry 无效、重复 id、越界/缺失路径和不可读取正文必须由稳定错误或 `tc doctor`
  检出，不能静默忽略。
- required Spec 在任务执行期间发生内容漂移时必须显式提示并要求刷新绑定、replan
  或用户决定；不得继续假装仍按原合同执行。
- Taskcraft 只验证引用、摘要和生命周期一致性，不声称能够自动判断 Markdown 语义
  是否与代码一致。

### R5. Finish 的 Spec Impact

- 任务收口时记录 `none | updated | candidate` 的 Spec Impact 判断。
- `none` 需要简短理由；`updated` 引用已更新的工程 Spec 和验证证据；`candidate`
  表示发现潜在长期规则但尚未成为真相，业务规则必须走这一分支等待用户确认。
- 一次性需求、实施过程和结果保留在 Task facts/evidence 中，不汇总进 Spec；只有未来
  任务仍需遵守的工程合同才写回当前 Spec。

### R6. 单一事实边界

- Spec 文件回答“当前项目应该如何开发”，Task Store 回答“该任务采用了哪些规范、
  如何执行和验收”，Git 历史保存规范与代码的变化。
- CLI、Watch、Node Brief 和 doctor 必须读取同一 Registry/Task Store 查询结果，
  不在各层重新推断 Spec 绑定。

### R7. 历史兼容

- 不为既有 Task 或旧 lifecycle revision 回填、推断或伪造 Spec binding、Spec Impact
  或“已读取”事实。
- 功能上线后新建 Task 使用新合同；既有 Task 只有在显式产生新 lifecycle revision
  时才可绑定当时确认的 Spec，并保留旧 revision 无绑定的历史事实。
- 旧 revision 必须继续可读、可投影和按原合同完成，不因缺少后来新增的 Spec 事实
  被误判为损坏。

## Out of Scope

- 自动从代码、聊天或历史 Task 生成业务真相。
- 自动证明 Agent 已理解 Spec，或自动证明 Spec 语义与代码一致。
- 云端 Spec 服务、团队权限、远程同步和跨仓库调度。
- 改变 Taskcraft“不启动、不停止、不调度 subagent”的产品边界。
- 为 L3 引入递归 child 或第二套任务分解模型。

## Acceptance Criteria

- [x] 初始化或显式注册后，项目具有可验证的 Spec Registry；正文留在 Git 文件中，
      Task Store 不保存正文副本。
- [x] 公开 CLI 能列出、检查并解析某个任务/节点适用的 Spec，JSON 与文本输出同源。
- [x] L1、L2、L3 single 和 L3 modules 均有真实闭环样本，证明 Spec 绑定进入正确
      revision/node；L3 child 从 accepted parent Plan 继承且不重复选择。
- [x] Execute 与 Review Node Brief 显示同一 revision 的适用 Spec；缺失或漂移的
      required Spec 产生稳定失败和可执行 remediation。
- [x] Record/完成合同保存 `none | updated | candidate` Spec Impact；未经用户确认的
      业务候选不会被登记为当前业务真相。
- [x] `tc doctor` 覆盖 Registry、路径、摘要、孤儿绑定和 L3 inherited binding
      完整性，损坏时非零退出且不写入部分事实。
- [x] Store migration、reducer 事务、projector、CLI、Codex/Claude Node Brief、Watch
      DTO 与现有 L1/L2/L3 回归全部通过。
- [x] 删除任何 CLI/Watch 临时视图后，仍能由 Git Spec + SQLite bindings 重建相同
      Spec 状态和任务视图。

## Notes

- 这是结构性功能：它跨越文件规范源、SQLite definition facts、lifecycle compiler、
  reducer/projector、Node Brief、CLI、Watch 和 doctor，不能通过只改 prompt 完成。
