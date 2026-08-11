# Taskcraft 实现路线

本路线只描述交付顺序和阶段门。产品行为以 `../specs/` 为准，数据约束以 `../contracts/` 为准；每个阶段的 Trellis 拆分由该阶段的 PRD、design 和 implement 决定。

## 路线总览

| 阶段 | 状态 | 可交付结果 | 退出门 |
| --- | --- | --- | --- |
| [Task 00](task-00-contract-baseline.md) 合同与基线 | 已完成（2026-08-10） | 关键 ADR、可解析合同、宿主假设证据、稳定 Git 基线 | 影响 reducer/CLI/Schema 的问题只有一种解释 |
| [Task 01](task-01-engineering-foundation.md) 工程基础 | 已完成（2026-08-11） | 可安装、测试、构建、迁移的最小工程 | 空库 migration、Schema fixture、静态检查和构建通过 |
| [Task 02](task-02-l1-vertical-slice.md) L1 纵切 | 已完成（2026-08-11） | Store、单 reducer/projector、L1 CLI 闭环 | L1 真实任务完成；事务失败无部分事实；投影可重建 |
| [Task 03](task-03-l2-review-loop.md) L2 Review | 未开始 | 独立 Review 节点及三种 outcome 回流 | passed/changes/replan 均有可追溯样本 |
| [Task 04](task-04-host-adapters.md) Adapter | 未开始 | Codex/Claude 恢复、Node Brief、能力披露 | 两宿主 conformance 和真实 Hook smoke 通过 |
| [Task 05](task-05-l3.md) L3 | 未开始 | Plan、Feasibility Review、Execute、Integrate | Plan Review 前 Execute 不可运行；revision 保持可追溯 |
| [Task 06](task-06-watch.md) Watch | 未开始 | 只读 Board、详情、Runtime、Diagnostics | 页面、CLI JSON、breadcrumb 的 status/next 一致 |

默认在全部阶段完成后执行 [`../runbooks/trellis-to-taskcraft.md`](../runbooks/trellis-to-taskcraft.md)，由 Taskcraft 接管后续缺陷修复、性能优化和版本迭代。Trellis 与 Taskcraft 不设置双写过渡期。

## 关键顺序判断

- Task 00 先做只读宿主探针，防止用未经验证的 Hook、运行标识或 Review 独立性假设冻结数据合同。
- Task 02 按 L1 纵切实现内核，只构建当前闭环需要的 reducer/projector 能力；L2/L3 能力在后续阶段扩展同一实现，不创建平行状态机。
- Task 03 先证明 Review 事实和回流，再由 Task 04 接入真实宿主观察，避免 Adapter 反向定义产品状态。
- Task 05 复用 L2 Review 合同增加 feasibility purpose，不引入第二套 Review 模型。
- Task 06 只消费 projector/query contract，静态原型数据不得进入生产事实路径。

## 每阶段共同验收

1. 规范、Schema/SQL 与实现合同没有相互矛盾。
2. SQLite 仍是唯一可写 Task Store，Command service 仍是唯一写入口。
3. 单 reducer 写事实，单 projector 推导五状态与 next。
4. 错误保持显式，不增加吞错、伪成功或隐藏 fallback。
5. 验证按合同测试、reducer/transaction、adapter、UI、真实宿主样本的适用顺序执行。
6. Trellis 只管理开发过程；可复用结论已经回写到 `development/` 的唯一规范位置。

## 主要风险

| 风险 | 控制 |
| --- | --- |
| 动态图退化成多套静态 workflow | 所有 Level 共享一个 reducer/projector；顶层状态固定为五种 |
| 投影成为第二事实源 | Watch、Markdown、breadcrumb、cache 和 telemetry 只读 |
| 宿主观察被误当成任务结果 | `agent_runs` 只存 observation，必须经 reducer command 转成 runtime fact |
| Review 独立性被夸大 | 保存 `reviewed_attempt_id`、capability 与 independence status |
| Hook 能力被文档假设替代 | 先做真实 host smoke，失败时明确报错和诊断 |
| Trellis 与 Taskcraft 双写 | 按迁移 runbook 冻结、卸载并在新会话切换唯一活动系统 |
| Trellis 规范复制产品合同 | `.trellis/spec` 只保存索引与代码约定，产品事实仍在 `development/` |
