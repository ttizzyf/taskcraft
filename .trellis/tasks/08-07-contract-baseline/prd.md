# Freeze Taskcraft contracts and repository baseline

## Goal

在编写 Taskcraft 生产代码前，消除会改变 reducer、CLI、SQLite/JSON
合同和宿主 Adapter 边界的歧义，并形成 Task 01 可以直接消费的、可审阅且
可验证的合同基线。

## Background And Confirmed Facts

- 源需求为 `development/plans/task-00-contract-baseline.md`；该计划只定义
  阶段交付顺序，产品行为仍以 `AGENTS.md`、`development/specs/` 和冻结后的
  `development/contracts/` 为准。
- 本任务属于 L3：它涉及跨模块合同、Schema、权限与数据完整性边界、宿主
  可行性探针和多项独立决策。
- `ba20823` 已建立 Taskcraft 文档与合同的首个 Git 基线；`276565a` 随后
  单独提交了 Trellis Bootstrap 产生的三个规范索引，因此“先有项目基线、
  后做 Trellis Bootstrap”的提交顺序已经成立。
- 本任务规划开始时，工作区仍有未提交的 Trellis 初始化文件以及相关文档
  修改；这些变更不属于 `276565a`。用户已决定它们必须在 Task 00 激活前
  作为独立前置基线完成审阅和提交，不得并入 Task 00 的交付范围。
- 当前规范已给出若干候选结论，但仍存在需要本任务统一冻结的边界。例如
  `development/specs/cli.md` 当前描述 `task new` 写入激活事实和首个 attempt，
  而本任务要求先确认 `task new`、`run` 与 `queued -> active` 的唯一职责。
- 历史审计和会话记录只用于发现问题或还原背景，不得覆盖当前规范。

## Requirements

### R1. Activation And Attempt Boundary

冻结 `queued -> active` 的唯一触发条件，以及 `task new`、`run` 和首个
attempt 的职责边界；产品规范、CLI 合同和 SQL 草案必须表达同一语义。

### R2. Review Routing

冻结 Review purpose 与被审核节点的映射：`feasibility -> plan`、
`delivery -> execute`、`integration -> integrate`。为 pass、R1 direct fix、
R2 successor 和 R3 replan 定义确定且可追溯的 next；若 integration finding
不能安全复用 R2，则必须显式升级为 R3 并记录理由。

### R3. Revision-Bound Inputs And Authorization

冻结用户输入、凭据和高风险授权与 task revision、lifecycle revision、node、
attempt/blocker 的绑定方式。旧授权不得被新 revision 静默复用，敏感内容的
保存、引用和脱敏边界必须明确。

### R4. Host Capability Evidence

为 Codex 和 Claude Code 的 Entry/Stop、结构化结果和 run correlation 定义
最小只读探针。能力声明必须区分官方文档、当前机器真实验证、能力限制和待
实现项，并保留来源、版本、时间和结果。

### R5. Engineering Decisions

通过 ADR 冻结实现语言、包管理器、SQLite driver、migration 策略、JSON
Schema 校验器和测试框架。每项选择必须说明理由、主要替代方案、退出成本和
Task 01 的直接输入。

### R6. Evaluator And Probe Safety

冻结 evidence evaluator 与只读 probe 的安全边界，包括允许的读取、禁止的
副作用、凭据/付费/高风险权限的用户决策门，以及失败如何显式暴露。

### R7. Authority And Repository Boundaries

确认规范、合同、阶段计划、研究、原型、历史审计和 Trellis 临时文件的权威
层级。提供无失效链接的文档索引，且不得让 Trellis 规划产物成为第二套产品
合同。

### R8. Initial Module Boundary

给出生产源码、测试和合同资产的最小目录与模块边界，为 Task 01 提供明确
输入；不得提前创建生产目录、无用抽象或业务实现。

### R9. Contract Updates And Review Gate

在修改产品规范、生命周期、CLI、架构或 SQL/JSON 合同前，先向用户提交
ADR 清单与只读探针清单并获得确认。合同修改必须消除旧语义，而不是新增
平行规则或隐藏 fallback。

### R10. Baseline Separation

Taskcraft 初始内容基线、Trellis 初始化/Bootstrap 与 Task 00 合同变更必须
保持可独立审阅；不得把不同来源的现有工作混入同一未说明的变更集。当前
未提交的 Trellis 初始化文件和相关文档修改是 Task 00 的前置基线，必须先
完成独立审阅和提交；Task 00 在此前保持 `planning`。

## Acceptance Criteria

- [ ] `task new` 是否激活、是否创建 attempt、`queued` 如何激活，在产品、
  lifecycle、CLI、架构和 SQL 合同中只有一种解释。
- [ ] feasibility、delivery、integration 的 pass、R1、R2、R3 路径均有
  确定 next；任何不支持的组合均显式拒绝或升级，不存在隐式路由。
- [ ] 用户输入、凭据和高风险授权具有可验证的 revision/node 绑定规则，旧
  授权不能被新 revision 静默复用。
- [ ] 所有工程技术选择均由 ADR 记录理由、替代方案、退出成本和 Task 01
  输入。
- [ ] Codex/Claude 能力矩阵中的声明均附真实只读探针，或明确标为
  `documented|pending|limited|deferred`，不会把文档能力写成已验证事实。
- [ ] evaluator/probe 的允许动作、禁止动作、用户决策门和显式失败行为已
  写入权威规范或 ADR。
- [ ] 当前规范不再引用失效编号或路径；历史审计明确为非规范来源；Markdown
  链接检查通过。
- [ ] JSON Schema 与 SQL 草案可以被工具解析，规范、SQL/Schema 和 CLI 的
  交叉一致性审阅无阻塞发现。
- [ ] Task 01 可从 ADR、模块边界和冻结合同中获得明确输入，无需重新决定
  Task 00 范围内的事项。
- [ ] 变更历史可分别审阅项目初始基线、Trellis 初始化/Bootstrap 和 Task 00
  合同变更。
- [ ] Task 00 激活前，当前 Trellis 初始化文件及相关文档修改已作为独立
  前置基线完成审阅和提交，Task 00 变更集不包含这些既有变更。
- [ ] 本任务不引入 reducer、CLI、Watch、动态 lifecycle compiler 或宿主
  Hook 等生产业务行为。

## Out Of Scope

- 实现 reducer、projector、CLI、Watch 或动态 lifecycle compiler。
- 安装或嵌入 Taskcraft 自己的 Hook。
- 把研究材料、原型、历史会话或 Trellis 任务产物提升为独立产品事实源。
- 提前执行 Task 01 的工程骨架、migration runner 或测试框架实现。
