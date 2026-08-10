# Design: Task 00 Contract Baseline

## Structural Judgment

本任务是结构性合同冻结，不适合用单文件补丁处理。它同时涉及激活语义、
Review 回流、用户决定与 secret 边界、宿主能力证据、技术栈、SQL/JSON 合同和
文档权威层级。正确的不变量是：每个产品概念只在一个权威位置定义，其他
文档引用该定义；SQLite 约束、CLI transition 和生命周期描述必须映射到同一
语义。

父任务保存源需求、任务图、跨子任务验收和最终一致性结论。实际交付按顺序
落在三个可独立验收的子任务中，避免探针、决策、合同修改和仓库收口混入
同一不可审阅变更集。

## Entry Gate

Task 00 及其子任务在以下条件满足前不得 `task.py start`：

1. 当前 Trellis 初始化文件和相关文档修改已作为独立前置基线审阅并提交。
2. 该提交未混入 Taskcraft 合同语义变更。
3. `AGENTS.md` 的 Taskcraft 不变量仍位于 Trellis managed block 之外。
4. Trellis 的运行时/session 文件遵守其 `.gitignore`，不会进入后续合同 diff。
5. 用户已批准本规划摘要；任务工件若发生实质变化，必须重新批准。

该门禁已通过：用户批准了最终规划、ADR 清单和探针清单；独立 Trellis
初始化基线已由提交 `db393bb` 落地，未包含 Taskcraft 产品合同变更。

## Task Map

| 顺序 | 子任务 | 直接产物 | 进入条件 |
| --- | --- | --- | --- |
| 1 | `08-07-contract-probes-decisions` | ADR、宿主探针证据、能力矩阵和安全边界 | Entry Gate 通过 |
| 2 | `08-07-runtime-contract-freeze` | 对齐后的 product/lifecycle/CLI/architecture/SQL/JSON 合同 | 子任务 1 完成，ADR 与探针清单获用户批准 |
| 3 | `08-07-repository-contract-baseline` | 权威索引、最小模块边界、Task 01 输入和全量验证报告 | 子任务 2 完成且合同检查通过 |
| 4 | 父任务集成验收 | 需求到交付映射、跨文件一致性结论和残余风险 | 三个子任务完成 |

父子关系只表达验收归属。顺序由各子任务工件中的显式依赖约束，不依赖目录
或父子关系隐式推导。

## Decision And Contract Flow

```text
current specs/contracts/research
  -> evidence inventory
  -> approved probe execution
  -> ADR decision set
  -> user approval gate
  -> authoritative spec changes
  -> SQL/JSON executable contract changes
  -> authority/index/module-boundary cleanup
  -> cross-contract validation
  -> Task 01 handoff
```

研究结果在写入 ADR、规范或合同前只属于带时效性的证据。ADR 记录为什么
选择；`development/specs/` 定义产品语义；`development/contracts/` 提供可执行
结构约束；Trellis 工件只保存本次执行计划和审阅记录。

## Accepted ADR Set

| ADR | 冻结内容 |
| --- | --- |
| `0001-task-activation-and-attempt-ownership.md` | `queued -> active`、`task new`、`run`、首个 attempt |
| `0002-review-purpose-and-remediation-routing.md` | purpose 映射和 `passed|changes_requested|replan_required` |
| `0003-revision-bound-inputs-and-authorization.md` | 用户输入、secret、高风险决定和现有 fact/blocker 复用 |
| `0004-host-capability-evidence-and-run-correlation.md` | 能力状态、Entry/Stop、结构化结果、run correlation |
| `0005-implementation-language-and-toolchain.md` | 语言、包管理、SQLite driver、Schema validator、测试框架 |
| `0006-migrations-and-contract-validation.md` | migration 策略、SQL/JSON 合同验证和退出成本 |
| `0007-evaluator-and-probe-safety-boundary.md` | 本地结果校验、Agent 工具、显式失败和用户决策边界 |
| `0008-document-authority-and-module-boundaries.md` | 权威层级、最小源码/测试/合同边界和 Task 01 输入 |

ADR 可以在不丢失上述决策映射的前提下合并，但不得把两种相互竞争的规则
同时保留为有效合同。

## Executed Probe Set

所有探针在临时目录执行，不修改仓库合同、不安装 Taskcraft Hook、不创建
外部资源。模型调用会使用本机现有 Codex/Claude 凭据并可能产生额度消耗，
因此必须包含在用户批准的探针清单中。

| Probe | 目的 | 允许的影响 |
| --- | --- | --- |
| `CX-01` | 记录 Codex 版本、CLI/help 与官方能力字段 | 本地只读命令 |
| `CX-02` | 临时 Entry/Stop hook 连续执行 smoke | 临时文件、Codex 会话元数据、一次最小模型调用 |
| `CX-03` | 验证 JSON 事件、output schema 与 session/turn/agent correlation | 临时文件、一次最小模型调用 |
| `CL-01` | 记录 Claude Code 版本、CLI/help 与官方能力字段 | 本地只读命令 |
| `CL-02` | 临时 Entry/Stop/SubagentStop hook smoke | 临时文件、Claude 会话元数据、一次最小模型调用 |
| `CL-03` | 验证 JSON Schema、hook events 与 session/agent correlation | 临时文件、一次最小模型调用 |
| `DB-01` | 在内存 SQLite 重放现有跨 revision、Review、evidence 和事件序列约束 | 仅内存数据库 |

每项结果记录 host/tool 版本、日期、命令摘要、输入 Schema、退出码、观察到的
字段、结论和限制。任何需要新凭据、付费升级、外部写入或更高权限的扩展探针
停止并创建明确的用户决策门，不做静默降级。

## Contract Ownership

| 概念 | 唯一规则源 | 其他消费者 |
| --- | --- | --- |
| 产品边界与用户旅程 | `development/specs/product.md` | CLI、Watch 计划 |
| node/review/连续执行语义 | `development/specs/lifecycle.md` | architecture、CLI、SQL |
| 写入/投影/Adapter 边界 | `development/specs/architecture.md` | CLI、SQL、Task 01 |
| 命令 transition 与 JSON/error surface | `development/specs/cli.md` | Task 01/02 |
| 数据结构和可执行约束 | `development/contracts/storage.sql`、JSON Schema | contract tests |
| 决策理由与退出成本 | `development/decisions/` | specs/contracts/Task 01 |

交叉文件不得复制完整规则。能通过链接引用的内容使用引用；SQL 无法表达的
语义约束必须明确归属 reducer，而不是用注释伪装为数据库强保证。

## Compatibility And Rollback

- 仓库尚无生产实现、生产数据或公开版本，因此不保留旧合同的兼容分支。
- 每个子任务独立提交；发生问题时回退该子任务提交，不回退前置 Trellis
  基线或其他用户变更。
- 合同编辑采用“删除旧语义并替换为唯一规则”的方式，不增加 alias、fallback
  或双写迁移。
- 探针失败保留失败证据并降低 capability 状态；不得伪造成功结果。
- 任何合同变更若推翻已批准 ADR，先修改 ADR 和规划摘要并重新请求用户批准。

## Final Integration Review

父任务最终只做跨子任务验收：逐条映射 REQ-01 至 REQ-10 与 Acceptance
Criteria，检查术语、枚举、链接、SQL/JSON 可解析性、CLI transition 和 Task 01 输入。若发现
产品决策缺口，回到子任务 1；若发现合同映射错误，回到子任务 2；若仅是索引
或交接问题，回到子任务 3。
