# Freeze Taskcraft Runtime Contracts

## Goal

把已批准 ADR 落为唯一、相互一致的 Taskcraft 产品、生命周期、CLI、架构和
SQL/JSON 合同，消除 reducer/CLI/Schema 实现前的歧义。

## Dependencies

- `08-07-contract-probes-decisions` 已完成并归档。
- 实际 ADR 结论与探针结果已经用户批准。

## Requirements

- 统一 activation、`task new`、`run` 和首个 attempt 的职责。
- Review 只保留 `passed|changes_requested|replan_required`；删除
  `passed_with_fix`、R1/R2/R3 和 `review_resolutions`。
- 用户输入复用 task fact/blocker/event；secret 不落库；不新增输入、凭据、
  授权或 probe 实体。
- host/adapter id 使用开放字符串；首版只实现支持 Hook 的 Codex 与 Claude，
  不建立 Adapter 注册表或无 Hook 降级系统。
- Node Brief 提供执行/派发说明；Agent 自己决定是否使用 subagent，没有就自己
  执行。用户打断始终有效。
- 模型原生 JSON Schema 是可选能力；Taskcraft 在写入边界本地校验所有结果。
- SQL/JSON 只强制其能真实表达的不变量；其余校验明确归 reducer。
- 同步 `development/plans` 中仍要求独立 Agent、无 Hook 降级或额外运行系统的
  后续任务描述。
- 删除冲突旧规则，不保留兼容分支、隐式 fallback 或第二来源。

## Acceptance Criteria

- [ ] activation 和首个 attempt 在所有权威文件中只有一种解释。
- [ ] 三种 Review outcome 都有确定 next，不存在 resolution 第二实体。
- [ ] 用户输入、高风险决定和 secret 边界只使用现有 fact/blocker/event 表达。
- [ ] host 可扩展但首版 Adapter 范围明确；Taskcraft 不派发 subagent。
- [ ] Hook 正常结束、用户打断和下次恢复的行为一致。
- [ ] SQL 可在空内存库加载，关键正反例 constraint probes 结果符合 ADR。
- [ ] JSON Schema 可按 Draft 2020-12 编译，fixtures 通过或有明确预期失败。
- [ ] Task 03/04/05 与 roadmap 不再要求已删除的复杂机制。
- [ ] 不引入生产业务实现。

## Out Of Scope

- 文档索引、最终模块目录和 Task 01 工程交接整理。
- 实现 reducer、CLI、Adapter、Watch 或 migration runner。
- 对未批准 ADR 做新的产品选择。
