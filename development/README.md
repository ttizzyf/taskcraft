# Taskcraft 开发文档

本目录是 Taskcraft 产品设计、实现合同、架构决策、阶段计划和开发操作手册的唯一入口。项目已使用 Trellis `0.6.14` 完成 Codex/Claude 初始化；Task 00–06 的阶段任务已经归档，Task 07 于 2026-08-14 完成代码返工。当前产品已按 ADR 0009 移除 Stop Hook，连续推进改为 Agent 自主判断、typed waiting 和 Entry Hook 恢复；L3 已升级为 planning/execution 两阶段合同，可原子物化一层真实 L1/L2 children，也保留经审核的 single 模式。2026-08-17 已通过公共 `tc agent test-entry-hook --agent codex` 完成 Codex 0.147.0 真实宿主复核；Claude 同命令仍未取得成功结果，因此按当前“双宿主均通过”的迁移手册，狗粮化迁移门仍为 `blocked`。达到 Taskcraft 狗粮化门槛后，Trellis 才会被完整退出，两个系统不并行维护活动任务。

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
| [`contracts/`](contracts/) | [SQLite 合同](contracts/storage.sql)、[Lifecycle Schema](contracts/lifecycle.schema.json)、[Breadcrumb Schema](contracts/breadcrumb.schema.json)、[Spec Registry Schema](contracts/spec-registry.schema.json)、[fixtures](contracts/fixtures/) |
| [`decisions/`](decisions/) | [Task 00 架构决策索引](decisions/README.md) |
| [`plans/`](plans/) | [路线图](plans/roadmap.md)与 Task 00–07；当前复核与返工入口为 [Task 07](plans/task-07-mvp-readiness-remediation.md) |
| [`runbooks/`](runbooks/) | [Trellis 开发手册](runbooks/trellis.md)与 [Trellis → Taskcraft 迁移手册](runbooks/trellis-to-taskcraft.md) |
| [`research/`](research/) | [Codex/Claude 宿主可行性报告](research/host-feasibility.md)；当前现场结果见 [2026-08-17 Entry Hook smoke](entry-hook-smoke-2026-08-17.md) |
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
Task 00 → 01 → 02 → 03 → 04 → 05 → 06 → 07 返工复核 → Trellis 退出 → Taskcraft 狗粮化
```

## 从哪里开始

1. Trellis `0.6.14` 初始化与 Bootstrap 已完成；Bootstrap 只建立规范索引，不复制 Taskcraft 合同。
2. Trellis 项目文件、Hook、skill 和 managed block 必须作为独立初始化基线审阅和提交，不得与 Task 00 合同变更混合。
3. Task 00–06 的实现和归档历史保留，但不得据此跳过 [Task 07](plans/task-07-mvp-readiness-remediation.md) 的问题复现和验收。
4. Task 07 的代码返工和 L3 模块化合同已实现：doctor、waiting/resume/retry、Runtime、真实 child/replan/integrate、Hook Diagnostics 和 `agent_runs` 单写入口均有自动验证；公开 CLI 的 modules/single L3 闭环也已回放。Stop Hook 已在 ADR 0009 中移除。Codex Entry 真实复核已通过，下一步只补 Claude 的公共 `test-entry-hook` 成功证据。
5. Task 07 完成并重新满足 [迁移手册](runbooks/trellis-to-taskcraft.md)全部进入条件后，才在全新会话中退出 Trellis 并开始狗粮化。
