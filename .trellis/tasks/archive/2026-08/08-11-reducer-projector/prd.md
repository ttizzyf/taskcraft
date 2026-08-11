# Reducer and projector

## Goal

交付 L1 内置 lifecycle 图、单 reducer（唯一写入口）与单 projector（唯一状态
推导），并提供覆盖五状态与边界语义的 fixtures 和测试。

## Requirements

### REQ-01. L1 Built-in Lifecycle Graph

静态定义 L1 图：`execute-1 -> record-1`；required obligations 为
`requested-outcome-produced`、`minimum-validation-recorded`（execute）与
`result-and-scope-retained`（record）；execute/record 的 result schema
（Draft 2020-12 JSON Schema）与 obligation evaluator 静态定义。图在
`task new` 时以 revision 1 写入 `lifecycle_revisions` / `lifecycle_nodes` /
`lifecycle_edges` / `obligation_definitions`。

### REQ-02. Single Reducer

`taskNew` / `run` / `runComplete` / `cancel` 四个命令经过同一 reducer：
校验 CAS（复用 store-transaction 的守卫）与引用（task/node/attempt/evidence
归属）、校验 result schema（失败 `TC_LIFECYCLE_RESULT_INVALID`，不写部分
事实）、原子写事实 + 一条审计 event（task_seq 连续，触发
`events_task_sequence_insert`）、单事务提交。required obligation 只能由目标
attempt 的有效 evidence 满足；`run complete` 在同一事务闭合 record
obligation。attempt 失败/重试耗尽语义保留（写 `failed_retries_exhausted`
blocker），但 retry/wait 命令不在本任务。

### REQ-03. Single Projector

纯推导：五公开状态（优先级 cancelled > done > waiting > active > queued）、
runnable/running 节点、typed waitingReason（open blocker 的
`waiting_reason`）、唯一 next 命令、required obligation 完成度。projector
不写库；`agent_runs` observation 永不参与推导。

### REQ-04. Command Result & Breadcrumb Types

`tc-command-result/v1` 成功/失败结构与稳定错误类型（`TC_TASK_*` /
`TC_LIFECYCLE_*` / `TC_REVISION_*` / `TC_EVIDENCE_*` / `TC_STORE_*`，含
problem/impact/remediation）；breadcrumb 按 `breadcrumb.schema.json` 构造。
本子任务只交付类型与构造器，CLI 接线在 l1-cli-smoke。

### REQ-05. Fixtures

在 `development/contracts/fixtures/` 新增（不改既有文件）：l1-pass、
validation-missing、five-status、revision-conflict、transaction-rollback、
cancel、retry-exhaustion；每条 fixture 是合同样例，测试消费它验证
projector/reducer 语义。

### REQ-06. Tests

reducer 原子写与回滚（无部分事实）、obligation/evidence 规则（验证缺失不
能 done、evidence 归属校验）、projector 五状态 + waiting + 唯一 next、
observation 不驱动完成、retry exhaustion fixture、CAS 冲突。单组硬超时
60 秒。

## Acceptance Criteria

- [ ] `tasks` 不保存公开 status；projector 从事实推导，删除只读输出可重建。
- [ ] 失败 reducer 事务不产生部分事实、孤立事件或孤立 attempt。
- [ ] observation 的 finished 不能直接令任务完成。
- [ ] required obligation 只能由目标 attempt 的有效 evidence 满足。
- [ ] 缺少 minimum validation evidence 时 L1 不能投影为 done。
- [ ] 五状态与 waitingReason 推导符合父任务 design.md 的 Projector Invariants。
- [ ] 新增文件有效行 ≤ 400；`pnpm check` 全绿。

## Non-goals

- 不实现任何 CLI 命令或渲染（l1-cli-smoke）。
- 不实现 review / wait / retry / evidence add 命令（Task 03+）。
- 不实现 L2/L3 图编译与动态 lifecycle compiler。
- 不改 storage.sql 与既有 fixtures。

## Notes

- 依赖已归档的 `store-transaction`（事务 + CAS + query model）。
- 语义细节以父任务 design.md（L1 Built-in Lifecycle / Reducer Command
  Semantics / Projector Invariants）为权威。
