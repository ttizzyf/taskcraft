# Freeze Taskcraft contracts and repository baseline

## Goal

在编写 Taskcraft 生产代码前，消除会改变 reducer、CLI、SQLite/JSON
合同和宿主 Adapter 边界的歧义，并形成 Task 01 可以直接消费的、可审阅且
可验证的合同基线。

## Background And Confirmed Facts

- 源需求为 `development/plans/task-00-contract-baseline.md`；该计划只定义
  阶段交付顺序，产品行为仍以 `AGENTS.md`、`development/specs/` 和冻结后的
  `development/contracts/` 为准。
- 本任务涉及跨模块合同、Schema、数据完整性边界、宿主可行性探针和多项
  独立决策，因此拆成三个可分别验收的子任务。
- `ba20823` 已建立 Taskcraft 文档与合同的首个 Git 基线；`276565a` 随后
  单独提交了 Trellis Bootstrap 产生的三个规范索引，因此“先有项目基线、
  后做 Trellis Bootstrap”的提交顺序已经成立。
- 本任务规划开始时，工作区仍有未提交的 Trellis 初始化文件以及相关文档
  修改；这些变更不属于 `276565a`。用户已决定它们必须在 Task 00 激活前
  作为独立前置基线完成审阅和提交，不得并入 Task 00 的交付范围。该门禁
  已由提交 `db393bb`（`chore: establish Trellis workflow baseline`）满足。
- 本任务规划时，`development/specs/cli.md` 曾把 `task new` 描述为同时写入激活
  事实和首个 attempt。该矛盾现已由 ADR 0001 和冻结后的合同消除。
- 历史审计和会话记录只用于发现问题或还原背景，不得覆盖当前规范。

## Requirements

### REQ-01. Activation And Attempt Boundary

冻结 `queued -> active` 的唯一触发条件，以及 `task new`、`run` 和首个
attempt 的职责边界；产品规范、CLI 合同和 SQL 草案必须表达同一语义。

### REQ-02. Review Routing

冻结 Review purpose 与被审核节点的映射：`feasibility -> plan`、
`delivery -> execute`、`integration -> integrate`。Review 只保留
`passed|changes_requested|replan_required`：通过后沿 lifecycle edge 前进，
要求修改时创建被审核节点的同 kind successor，需要重做计划时创建新 revision。

### REQ-03. User Input, Secrets And High-Risk Decisions

缺少输入或需要用户决定时复用现有 blocker、task fact 和 event。secret 不进入
Task Store；高风险操作由 Agent 先询问用户并记录必要的非敏感决定，不建立
Input、Credential 或 Authorization 系统。

### REQ-04. Host Capability Evidence

为 Codex 和 Claude Code 的 Entry/Stop、结构化结果和 run correlation 定义
最小只读探针。能力声明必须区分官方文档、当前机器真实验证、能力限制和待
实现项，并保留来源、版本、时间和结果。

### REQ-05. Engineering Decisions

通过 ADR 冻结实现语言、包管理器、SQLite driver、migration 策略、JSON
Schema 校验器和测试框架。每项选择必须说明理由、主要替代方案、退出成本和
Task 01 的直接输入。

### REQ-06. Result Validation And Agent Tool Boundary

Taskcraft 只做确定性的本地结果校验，不执行 shell、网络或外部写入。环境检查
由 Agent 使用宿主工具完成；需要新凭据、付费、外部写入或高风险权限时先询问
用户，失败必须显式保留，不实现通用 probe runner。

### REQ-07. Authority And Repository Boundaries

确认规范、合同、阶段计划、研究、原型、历史审计和 Trellis 临时文件的权威
层级。提供无失效链接的文档索引，且不得让 Trellis 规划产物成为第二套产品
合同。

### REQ-08. Initial Module Boundary

给出生产源码、测试和合同资产的最小目录与模块边界，为 Task 01 提供明确
输入；不得提前创建生产目录、无用抽象或业务实现。

### REQ-09. Contract Updates And Review Gate

在修改产品规范、生命周期、CLI、架构或 SQL/JSON 合同前，先向用户提交
ADR 清单与只读探针清单并获得确认。合同修改必须消除旧语义，而不是新增
平行规则或隐藏 fallback。

### REQ-10. Baseline Separation

Taskcraft 初始内容基线、Trellis 初始化/Bootstrap 与 Task 00 合同变更必须
保持可独立审阅；不得把不同来源的现有工作混入同一未说明的变更集。当前
未提交的 Trellis 初始化文件和相关文档修改是 Task 00 的前置基线，必须先
完成独立审阅和提交；Task 00 在此前保持 `planning`。

## Acceptance Criteria

- [x] `task new` 是否激活、是否创建 attempt、`queued` 如何激活，在产品、
  lifecycle、CLI、架构和 SQL 合同中只有一种解释。
- [x] feasibility、delivery、integration 的三个 Review outcome 均有确定 next；
  不存在额外的 Review 等级、resolution 实体或隐式路由。
- [x] 用户输入和高风险决定复用现有 fact/blocker/event；secret 不进入 Task
  Store，且没有提前建设凭据或授权系统。
- [x] 所有工程技术选择均由 ADR 记录理由、替代方案、退出成本和 Task 01
  输入。
- [x] Codex/Claude 能力矩阵中的声明均附真实只读探针，或明确标为
  `documented|pending|limited|deferred`，不会把文档能力写成已验证事实。
- [x] Taskcraft 本地结果校验与 Agent 宿主工具的边界、用户决策门和显式失败
  行为已写入权威规范或 ADR，且没有通用 probe runner。
- [x] 当前规范不再引用失效编号或路径；历史审计明确为非规范来源；Markdown
  链接检查通过。
- [x] JSON Schema 与 SQL 草案可以被工具解析，规范、SQL/Schema 和 CLI 的
  交叉一致性审阅无阻塞发现。
- [x] Task 01 可从 ADR、模块边界和冻结合同中获得明确输入，无需重新决定
  Task 00 范围内的事项。
- [x] 变更历史可分别审阅项目初始基线、Trellis 初始化/Bootstrap 和 Task 00
  合同变更。
- [x] Task 00 激活前，当前 Trellis 初始化文件及相关文档修改已作为独立
  前置基线完成审阅和提交，Task 00 变更集不包含这些既有变更。
- [x] 本任务不引入 reducer、CLI、Watch、动态 lifecycle compiler 或宿主
  Hook 等生产业务行为。

## Out Of Scope

- 实现 reducer、projector、CLI、Watch 或动态 lifecycle compiler。
- 安装或嵌入 Taskcraft 自己的 Hook。
- 把研究材料、原型、历史会话或 Trellis 任务产物提升为独立产品事实源。
- 提前执行 Task 01 的工程骨架、migration runner 或测试框架实现。
