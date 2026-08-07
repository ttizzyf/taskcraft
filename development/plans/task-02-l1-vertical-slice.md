# 任务 02：Task Store 内核与 L1 Quick 纵切

## 目标

以一个真实 L1 闭环实现 Taskcraft 的最小正确性内核：SQLite 保存唯一规范事实，Command service 是唯一写入口，单 reducer 原子写事实，单 projector 推导状态和 next，CLI 能从建卡走到可审计的 `done`。

## 合并判断

本任务合并原“Store、Reducer 与 Projector”和“L1 Quick 纵切”。两者共享事务、状态推导、CLI result 与 fixture 边界，拆开会先形成没有真实用户闭环的水平内核，再重复做集成。合并后只实现 L1 所需能力；L2/L3 在同一 reducer/projector 上增量扩展，不预建平行状态机。

## 依赖

- 任务 01 完成。
- queued/active、首 attempt、事务、revision/CAS 和 evidence 最小合同已经冻结。

## 必读输入

- `AGENTS.md`
- `development/specs/product.md` 的 L1 用户旅程
- `development/specs/lifecycle.md` 的 L1、状态和连续执行合同
- `development/specs/architecture.md`
- `development/specs/cli.md` 的 L1 与 command result 合同
- `development/contracts/storage.sql`

## 范围

1. Task Store 连接、事务、WAL、busy timeout、migration 检查和 revision/CAS。
2. reducer 的引用校验、actor constraint、原子事实/事件写入和稳定错误。
3. projector 对五个公开状态、runnable node、typed waitingReason、required obligation 与唯一 next 的纯推导；fixture 覆盖五状态，但产品命令只交付 L1 路径。
4. L1 结构化判级、内置 `execute -> record` lifecycle、建卡/激活、attempt、结果、evidence、取消和 retry exhaustion。
5. `status`、`task show`、`task next`、最小 breadcrumb 以及同源 text/JSON 渲染。
6. 失败事务、并发冲突、stale observation 和无效 evidence 的显式边界。

## 交付物

- Store、transaction、reducer、projector 和 query model 的最小生产模块。
- 可执行的 L1 CLI 纵切与稳定 command result/error contract。
- L1 pass、验证缺失、五状态投影、revision conflict、rollback、cancel 和 retry exhaustion fixtures。
- 合同测试、reducer/transaction 测试、CLI 集成测试和真实本地 smoke。

## 验收标准

- `tasks` 不保存公开 status，删除只读输出后可从 SQLite 重建相同 status/next。
- 失败事务不产生部分事实、孤立事件或孤立 attempt。
- observation 的 finished 不能直接令任务完成。
- required obligation 只能由目标 attempt 的有效 evidence 满足。
- 缺少最小验证时 L1 不能投影为 done。
- 文本、JSON 与 breadcrumb 从同一 command result/query model 渲染。
- 并发冲突返回稳定错误和唯一恢复动作。

## 非目标

- 不实现 L2/L3 Review、动态 lifecycle compiler 或完整 Watch。
- 不实现自动接管 Hook 或宿主运行观察。
- 不为未来节点种类创建未被 L1 使用的平行服务层。

## 验证

1. SQL、Schema 与 L1 合同测试。
2. reducer 和事务测试，单组测试硬超时 60 秒。
3. projector fixture 与 CLI 集成测试。
4. 崩溃回滚、并发冲突和真实 L1 smoke。

## Trellis 拆分建议

把本阶段建为一个父任务；至少将“Store/transaction”“reducer/projector”“L1 CLI 与 smoke”拆成可独立检查的子任务。父任务负责共享 fixture、接口一致性和最终纵切验收，子任务树本身不表示依赖，依赖必须写入各自 `implement.md`。

## 后续启动提示

任务标题：`Deliver the Taskcraft store kernel and L1 vertical slice`

规划必须从一条真实、局部、可逆的 L1 用户路径反推最小内核。先描述事务边界、projector 不变量和稳定错误，再拆实现；验收时同时检查命令数、失败可见性和 SQLite 唯一事实源。
