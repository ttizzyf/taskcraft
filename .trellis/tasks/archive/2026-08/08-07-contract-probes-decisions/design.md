# Design: Probe And Decision Pack

## Evidence Method

按“当前权威合同 -> 官方资料 -> 本机只读/低副作用探针 -> ADR”的顺序建立
证据链。研究文件保存带时效性的观察，ADR 保存决定；两者不能互相替代。

宿主探针统一在 `mktemp -d` 创建的明确临时目录运行，使用最小 prompt 和最小
JSON Schema，设置硬超时，并在结果中披露会话元数据和额度影响。临时目录只
保存 probe 输入/输出；清理失败必须显式报告。

## Decision Matrix

每个 ADR 使用同一结构：Context、Decision Drivers、Options、Decision、
Consequences、Exit Cost、Contract Mapping、Task 01 Input、Evidence。

runtime ADR 先确定语义，再让后续子任务映射到文档/SQL。toolchain ADR 只冻结
Task 01 的选择，不在本任务安装依赖或创建工程文件。

## Safety Boundary

- local-only: version/help、文件读取、内存 SQLite，可直接按批准清单运行。
- credentialed-low-cost: Codex/Claude 最小模型调用，只能在用户批准的探针和
  次数预算内运行。
- decision-required: 新凭据、付费升级、外部资源写入、扩大权限或上传仓库
  内容，必须停止。
- prohibited: 修改真实宿主全局 Hook、写入 Taskcraft 产品数据库、伪造能力
  结果或吞掉探针失败。

## Deliverable Boundary

本子任务只写 `development/decisions/` 与必要的
`development/research/host-feasibility.md` 证据更新。合同正文由下一个子任务
集中修改，保证“决策审阅”和“合同落地”可以独立回滚。
