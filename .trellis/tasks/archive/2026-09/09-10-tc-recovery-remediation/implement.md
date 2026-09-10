# 执行计划

1. 审阅PRD/design并经用户确认后start；保存现有修改基线。
2. 派发Entry实现与恢复/校验实现，明确各自文件所有权；共享文件需协调，禁止修改evals或其配置。
3. 补定向回归：真实形状Hook事件、伪标记/失败事件、task show已领取卡与Review关联、无写入、重复run、具体字段错误及旧schema。
4. 按定向测试（后端单组60秒）、typecheck/lint、build、必要Adapter/Watch共享回归顺序验证；全套用当前项目既有配置，不动用户脚本。
5. 独立trellis-check审查，主会话更新直接相关的CLI/lifecycle/Entry实现合同；解决明确问题后再测。
6. 临时构建，按design并行公共Entry与DeepSeek盲测；控制器预验证和合理本地工具许可先完成，不向被测注入答案。
7. 报告真实结果并独立核对原始证据；取消未完成临时任务，清理本次进程/文件，保护用户evals。
8. 最终diff检查、保存新报告、按Trellis记录归档；不自动提交Git。

实现和检查manifest只供内部操作员，严禁传给被测Claude。
