# Design

扩展共享 Node Brief DTO 而不是在 Adapter 中解析文件。`run` 和 `review start` 从
binding query 构建同一 specs 数组；Adapter 只渲染。Task Detail DTO 增加 bindings、
drift 和 impact，CLI/Watch 从同一查询模型消费。

新 compiler 的 Record output schema 增加 typed `specImpact`，reducer 写入
`spec_impact_results` 并满足新的 required obligation。`updated` 验证 active Registry
snapshot/evidence；`candidate` 只保存待确认提案。旧 output schema 不变。

Doctor 的文件检查调用 Registry service，Store 检查调用 binding/impact query；结果
汇总为现有稳定 diagnostic envelope。Watch 仅渲染，不做语义或摘要判断。
