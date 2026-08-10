# Probe Hosts And Freeze Taskcraft Decision Set

## Goal

在修改任何 Taskcraft 产品合同前，用受控证据关闭运行时、宿主、安全和工程
技术选择中的关键未知项，并产出可由后续子任务直接执行的 ADR 集合。

## Dependencies

- Task 00 前置 Trellis 初始化基线已独立审阅并提交。
- 父任务规划、ADR 清单和 `CX-01..03`、`CL-01..03`、`DB-01` 探针清单已由
  用户批准。

## Requirements

- 建立现有 product/lifecycle/architecture/CLI/SQL/research 的矛盾矩阵。
- 执行且只执行批准的最小探针；记录版本、日期、命令摘要、退出码、字段、
  结论与限制。
- 将能力分为 `verified|documented|limited|pending|deferred`，不得把官方文档
  或 help 输出等同于真实宿主验证。
- 产出父任务 design 中定义的 8 项 ADR 决策映射，覆盖所有备选项、理由、
  退出成本和 Task 01 输入。
- 探针涉及新凭据、外部写入、付费升级、高风险权限或扩大范围时停止并请求
  决策，不做 fallback。
- 本子任务不得修改 product/lifecycle/architecture/CLI/SQL/JSON 的规范语义。

## Acceptance Criteria

- [ ] 8 项 ADR 决策均有证据、备选方案、取舍、退出成本和明确结论。
- [ ] 所有宿主能力声明可追溯到官方资料、版本化本机探针或明确的未验证状态。
- [ ] 探针没有修改仓库合同、安装 Taskcraft Hook 或创建外部资源。
- [ ] activation、Review routing、revision-bound auth、技术栈和安全边界均已
  形成后续合同子任务可机械核对的决策表。
- [ ] 用户已审阅实际 ADR 结论与探针结果，未决阻塞项为空。

## Out Of Scope

- 修改 Taskcraft 规范或可执行合同。
- 实现任何生产代码、工程骨架、migration runner 或 Adapter。
- 用探针结果直接写 Task Store 产品事实。
