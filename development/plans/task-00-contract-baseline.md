# 任务 00：合同冻结与仓库基线

> 后续合同更新（2026-08-14）：ADR 0009 已移除 Stop Hook。下文 Stop 探针是
> Task 00 当时的阶段输入，仅作为历史证据保留。

> 状态：已完成（2026-08-10）

## 目标

在编写生产代码前消除会改变 reducer、CLI 和数据结构的歧义，并把仓库整理成后续实现可以稳定扩展的形态。

## 依赖

无。这是所有实现任务的前置门。

## 必读输入

- `AGENTS.md`
- `development/specs/product.md`
- `development/specs/lifecycle.md`
- `development/specs/cli.md`
- `development/specs/architecture.md`
- `development/research/host-feasibility.md`
- `development/contracts/storage.sql`

`已移出活动仓库的历史审计` 只用于确认历史问题是否已经解决，不得覆盖当前规范。

## 范围

1. 冻结 `queued -> active` 的触发条件，以及 `task new`、`run` 和首个 attempt 的职责边界。
2. 冻结三个 Review outcome：`passed`、`changes_requested`、`replan_required`，以及 purpose 与被审核 node kind 的映射。
3. 冻结用户输入、secret 和高风险决定复用 task fact、blocker、event 的方式，不建立凭据或授权系统。
4. 对 Codex/Claude 的 Entry/Stop、结构化结果和 run correlation 做最小只读探针；把“官方支持”“本机验证”和“待实现”分开记录。
5. 决定实现语言、包管理、SQLite driver、migration 策略、Schema 校验器和测试框架。
6. 决定本地结果校验与 Agent 使用宿主工具检查的安全边界，不实现 probe runner。
7. 明确规范、规划、研究、原型和 Trellis 临时文件的权威层级。
8. 给出生产源码、测试和合同资产的初始模块边界，不提前创建无用抽象或顶层目录。

## 交付物

- `development/decisions/` 下的 ADR，覆盖上述决策。
- 修正后的产品、生命周期、CLI、架构与 SQL 合同。
- 一份无失效链接的文档索引。
- 最小工程目录设计和任务 01 的明确输入。
- 初始 Git 基线；Trellis 初始化必须发生在基线之后，并作为独立变更审阅。

## 验收标准

- `task new` 是否激活、是否创建 attempt、queued 如何激活只有一种解释。
- feasibility、delivery、integration 的三个 outcome 都有确定 next。
- 用户决定绑定来源 revision；secret 不进入 Task Store。
- 所有实现技术选择有理由、替代方案和退出成本。
- 宿主能力声明有真实探针，不会把文档能力写成已验证事实；研究证据级别不进入生产数据模型。
- 当前规范不再引用旧编号路径；历史审计明确标记为非规范。
- 本任务不引入生产业务行为。

## 非目标

- 不实现 reducer、CLI 或 Watch。
- 不实现动态 lifecycle compiler。
- 不安装或嵌入 Taskcraft 自己的 Hook。

## 验证

- Markdown 链接检查。
- JSON Schema 与 SQL 草案可解析检查。
- 对规范、SQL 和 CLI 做一次交叉一致性审阅。

## 后续启动提示

任务标题：`Freeze Taskcraft contracts and repository baseline`

请先阅读 AGENTS、产品规范、架构、SQL 合同、宿主可行性报告和本任务文档。规划完成后必须先由用户确认 ADR 与只读探针列表，再修改合同；历史审计只作为问题线索，不是规范来源。
