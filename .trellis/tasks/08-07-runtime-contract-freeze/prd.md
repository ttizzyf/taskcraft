# Freeze Taskcraft Runtime Contracts

## Goal

把已批准 ADR 落为唯一、相互一致的 Taskcraft 产品、生命周期、CLI、架构和
SQL/JSON 合同，消除 reducer/CLI/Schema 实现前的歧义。

## Dependencies

- `08-07-contract-probes-decisions` 已完成并归档。
- 实际 ADR 结论与探针结果已经用户批准。

## Requirements

- 统一 activation、`task new`、`run` 和首个 attempt 的职责。
- 统一 feasibility/delivery/integration purpose 与 pass/R1/R2/R3 路由。
- 统一 task revision、lifecycle revision、node、attempt/blocker 与用户输入、
  凭据、高风险授权的绑定和失效规则。
- 按 capability ADR 更新 Adapter/structured result/run correlation 合同。
- SQL/JSON 只强制其能真实表达的不变量；其余校验明确归 reducer。
- 删除冲突旧规则，不保留兼容分支、隐式 fallback 或第二来源。

## Acceptance Criteria

- [ ] activation 和首个 attempt 在所有权威文件中只有一种解释。
- [ ] 每种 Review purpose 和 outcome 都有确定 next 或稳定显式拒绝。
- [ ] 旧 revision 的输入/授权不能被新 revision 静默复用。
- [ ] capability、correlation 与 independence 术语在规范和合同中一致。
- [ ] SQL 可在空内存库加载，关键正反例 constraint probes 结果符合 ADR。
- [ ] JSON Schema 可按 Draft 2020-12 编译，fixtures 通过或有明确预期失败。
- [ ] 不引入生产业务实现。

## Out Of Scope

- 文档索引、最终模块目录和 Task 01 交接整理。
- 实现 reducer、CLI、Adapter、Watch 或 migration runner。
- 对未批准 ADR 做新的产品选择。
