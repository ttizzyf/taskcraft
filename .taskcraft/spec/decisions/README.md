# Taskcraft 架构决策

本目录记录已经接受的架构决策，解释“为什么这样选”。产品行为以
[`../product/`](../product/) 为准，可执行数据格式以
`development/contracts/`（schema 与 storage.sql 等机器合同，暂留原地）为准；
ADR 不能单独改变运行时合同。

## Task 00 决策

| ADR | 决定 |
| --- | --- |
| [0001：任务激活与 Attempt 归属](0001-task-activation-and-attempt-ownership.md) | `task new` 只建卡，`run` 负责激活并领取首个 attempt |
| [0002：Review 结果与返工路由](0002-review-purpose-and-remediation-routing.md) | Review 只保留通过、要求修改、重新规划三种结果 |
| [0003：用户输入、敏感信息与高风险操作](0003-revision-bound-inputs-and-authorization.md) | 复用已有 fact 和 blocker，不建设凭据或授权系统 |
| [0004：宿主能力与 Run 关联](0004-host-capability-evidence-and-run-correlation.md) | 首版支持 Codex/Claude Hook；能力现场检测，结果本地校验 |
| [0005：实现语言与工具链](0005-implementation-language-and-toolchain.md) | Node.js 24、pnpm 10、TypeScript、better-sqlite3、Ajv、Vitest |
| [0006：Migration 与合同验证](0006-migrations-and-contract-validation.md) | 顺序 SQL migration、checksum、事务回滚和结构化合同检查 |
| [0007：结果校验与 Agent 探测边界](0007-evaluator-and-probe-safety-boundary.md) | Taskcraft 校验结果；Agent 使用宿主工具检查环境 |
| [0008：文档权威与初始模块边界](0008-document-authority-and-module-boundaries.md) | 单 package 起步，只创建 Task 01 实际使用的模块 |
| [0009：Agent 自主推进与 Entry-only Hook](0009-agent-driven-continuation.md) | 移除 Stop Hook；任务连续性由持久事实、next、typed waiting 与 Entry 恢复承担 |
| [0010：L3 模块化父子任务](0010-l3-modular-task-decomposition.md) | accepted Plan 原子物化一层真实 L1/L2 children；保留经审核的 single 模式，不引入调度器 |

## 使用规则

- 查产品应该怎么运行，读 `../product/`。
- 查数据必须满足什么格式，读 `development/contracts/`（schema/SQL/fixtures 机器合同）。
- 查改代码要守的实现合同，读 `../engineering/`。
- 查某个选择的原因、替代方案和退出成本，读本目录对应 ADR。
- 后续若改变决定，新增或替代 ADR，并同步权威规范和合同；不要只改 ADR。
