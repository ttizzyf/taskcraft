# Taskcraft 开发文档

本目录是 Taskcraft 产品设计、实现合同、架构决策、阶段计划和开发操作手册的唯一入口。**2026-09-27 起本仓库已卸载 Trellis，Taskcraft（tc）是唯一的活动任务系统**，切换记录与审计点见 [`migrations/trellis-cutover-2026-09-27.md`](migrations/trellis-cutover-2026-09-27.md)（git 标签 `trellis-final`）。当前产品通过 Agent 自主判断、typed waiting 和 SessionStart Entry Hook 恢复保持任务连续性；L3 已升级为 planning/execution 两阶段合同，可原子物化一层真实 L1/L2 children，也保留经审核的 single 模式。2026-09-26 已在 Windows 本机完成公共 `tc agent test-entry-hook` 的**双宿主**真实宿主复核：claude 2.1.177（8.8s）与 codex 0.155.1（15.5s）均 `entryInjected: true`。迁移门七条进入条件的证据盘点见 [`migration-gate-audit-2026-09-27.md`](migration-gate-audit-2026-09-27.md)。

## 文档权威层级

发生冲突时按以下顺序处理：

1. 根目录 `AGENTS.md` 的产品不变量与开发约束。
2. `specs/` 的产品、生命周期、架构和 CLI 规范。
3. `contracts/` 的 SQL、JSON Schema 和 fixture，是可执行数据合同。
4. `decisions/` 的 ADR，解释选择原因；行为发生变化时仍须同步到规范和合同。
5. `plans/` 的路线与阶段任务，只定义交付顺序，不改写产品合同。
6. `runbooks/` 的工具操作步骤，不构成 Taskcraft 运行时设计。
7. `research/` 和 `prototypes/` 仅提供带时效性的证据与交互参考，不能覆盖上述规范。

研究结论只有写入规范、合同或 ADR 后才成为长期事实。Trellis 的 PRD、design、implement 和 journal 也遵守同一规则，不能成为第二套产品合同。

## 目录

| 分类 | 内容 |
| --- | --- |
| [`specs/`](specs/) | [产品](specs/product.md)、[生命周期](specs/lifecycle.md)、[架构](specs/architecture.md)、[CLI](specs/cli.md) |
| [`contracts/`](contracts/) | [SQLite 合同](contracts/storage.sql)、[Lifecycle Schema](contracts/lifecycle.schema.json)、[Breadcrumb Schema](contracts/breadcrumb.schema.json)、[Spec Registry Schema](contracts/spec-registry.schema.json)、六份跨层实现合同（从 `.trellis/spec` 迁入，已登记进 Spec Registry）、[fixtures](contracts/fixtures/) |
| [`decisions/`](decisions/) | [Task 00 架构决策索引](decisions/README.md) |
| [`plans/`](plans/) | [路线图](plans/roadmap.md)与 Task 00–07；当前复核与返工入口为 [Task 07](plans/task-07-mvp-readiness-remediation.md) |
| [`migrations/`](migrations/) | [Trellis → Taskcraft 切换记录](migrations/trellis-cutover-2026-09-27.md) |
| [`runbooks/`](runbooks/) | [Trellis → Taskcraft 迁移手册](runbooks/trellis-to-taskcraft.md)与 [Trellis 开发手册](runbooks/trellis.md)（均已转为历史文档） |
| [`research/`](research/) | [Codex/Claude 宿主可行性报告](research/host-feasibility.md)；当前现场结果见 [2026-09-26 Entry Hook smoke](entry-hook-smoke-2026-09-26.md)（[2026-08-17](entry-hook-smoke-2026-08-17.md) 为历史记录） |
| [`prototypes/`](prototypes/) | [Watch 静态原型](prototypes/watch.html) |

## 开发任务结论

原 Task 00–08 不需要保留为 9 个同级任务，先收敛为 Task 00–06 七个阶段包；
交付审查后追加 Task 07 作为跨阶段返工与迁移门复核：

| 新任务 | 来源 | 判断 |
| --- | --- | --- |
| [Task 00：合同与基线](plans/task-00-contract-baseline.md) | 原 00 | 保留为编码前审批门，并纳入关键宿主探针 |
| [Task 01：工程基础](plans/task-01-engineering-foundation.md) | 原 01 | 保留，隔离工具链和 migration 风险 |
| [Task 02：Store 内核与 L1 纵切](plans/task-02-l1-vertical-slice.md) | 原 02 + 03 | 合并，避免先造水平内核、后补真实用户闭环 |
| [Task 03：L2 与 Review](plans/task-03-l2-review-loop.md) | 原 04 | 保留，Review 回流是独立合同边界 |
| [Task 04：宿主 Adapter](plans/task-04-host-adapters.md) | 原 05 | 保留；Task 00 只验证可行性，本任务实现产品能力 |
| [Task 05：L3](plans/task-05-l3.md) | 原 07 | 保留，依赖 L2 与 Adapter 的真实能力 |
| [Task 06：Watch](plans/task-06-watch.md) | 原 08 | 保留，必须复用同一 projector 查询模型 |
| [Task 07：MVP 就绪度返工](plans/task-07-mvp-readiness-remediation.md) | 交付审查 | 补齐 doctor、waiting/resume、真实 Hook/恢复样本并收口合同 |

原 Task 06 Dogfood Cutover 不是产品实现任务，已并入迁移 runbook。当前必须在
Task 07 完成、MVP 进入条件重新验收通过后执行；这样符合“先完成 tc，再用 tc
开发 tc”的目标。每个阶段包是需求边界，不要求只对应一张 Trellis 任务；复杂
阶段应由 Trellis 根据 `design.md` 拆成可独立验收的父子任务。

依赖主线：

```text
Task 00 → 01 → 02 → 03 → 04 → 05 → 06 → 07 返工复核 → Trellis 退出（2026-09-27）→ Taskcraft 狗粮化
```

## 从哪里开始

1. 2026-09-27 已完成 Trellis 卸载与 tc 接管；后续开发任务全部用 `tc task new` 创建，见切换记录 §5 的建议任务清单。
2. Task 00–07 的实现与归档历史保留在 git 与 `trellis-final` 标签中，不据此宣称 MVP 门已验收；迁移门遗留的决策项见 [`migration-gate-audit-2026-09-27.md`](migration-gate-audit-2026-09-27.md)。
3. 修改代码前先读 [`contracts/`](contracts/) 中已登记的实现合同：`tc spec list` 可查当前登记条目。
4. 首张 L1 / L2 dogfood 任务在全新宿主会话中创建，不与卸载同会话。
