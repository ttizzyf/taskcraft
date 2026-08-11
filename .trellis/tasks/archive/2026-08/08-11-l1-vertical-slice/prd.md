# Deliver the Taskcraft store kernel and L1 vertical slice

## Goal

以一个真实 L1 闭环实现 Taskcraft 的最小正确性内核：SQLite 保存唯一规范事实，
Command service 是唯一写入口，单 reducer 原子写事实，单 projector 推导状态与
next，CLI 能从建卡走到可审计的 `done`。本任务只实现 L1 所需能力，L2/L3 在
同一 reducer/projector 上增量扩展。

## Background

- 来源需求是 `development/plans/task-02-l1-vertical-slice.md`（合并原
  "Store、Reducer 与 Projector" 与 "L1 Quick 纵切"）。
- Task 01 已完成并归档：`openDatabase` / `applyMigrations` /
  `createContractValidators` / `loadL2TaskFixture` 可复用，工程约束
  （max-lines 400、npmmirror 版本冻结、测试隔离、pretest build）见
  `development/task-02-handoff.md`。
- 已冻结且本任务不得改动：`development/contracts/storage.sql`、
  `lifecycle.schema.json`、`breadcrumb.schema.json`、`fixtures/` 与
  `development/plans/`。
- 用户已确认的范围决策：极简 `tc init`（只建目录 + DB + 迁移）；
  `run` 输出纯数据简化 Node Brief；最小 L1 命令集（evidence 随
  `run complete` 提交，wait/retry/evidence add 命令不做）；父任务 + 3 子任务。

## Requirements

### REQ-01. Store 与事务边界

在 Task 01 的 `openDatabase` / `applyMigrations` 之上提供：事务封装
（`BEGIN IMMEDIATE` / COMMIT / ROLLBACK，失败无部分事实）、revision/CAS
守卫（写命令携带 `expectedRevision`，不匹配返回 `TC_REVISION_CONFLICT`）、
query model（只读查询，供 projector/CLI 使用）。`tasks` 不保存公开 status。

### REQ-02. L1 内置 lifecycle 图

以静态定义交付 L1 图：`execute -> record` 两节点，required obligations 为
execute 的 "requested outcome produced" 与 "minimum validation recorded"、
record 的 "result and changed scope retained"。图与义务从 Task 01 已加载的
`l2-task.fixture.json` 语义对齐，但 fixture 是合同样例，不是实现来源。
L1 节点/边的 result schema 与 obligation evaluator 一并静态定义，供 reducer
的 Ajv 校验使用。`task new` 只接受 `--level 1`；level 2/3 返回显式稳定错误
（生命周期编译在后续任务交付）。

### REQ-03. 单 reducer

所有事实写命令经过同一 reducer：校验 `expectedRevision` 与引用、校验
lifecycle 合同 / outcome 规则 / result schema（失败返回
`TC_LIFECYCLE_RESULT_INVALID`，不写任何部分事实）、写规范事实与一条审计
event（`task_seq` 连续）、在单个 SQLite 事务内提交。required obligation
只能由目标节点 attempt 的有效 evidence 满足；observation
（`agent_runs`）的 finished 永不直接完成任务。

### REQ-04. 单 projector

从 SQLite 事实纯推导五公开状态（queued/active/waiting/done/cancelled）、
runnable node、typed waitingReason、required obligation 完成度与唯一 next。
`waiting` 需要 open blocker 且无 runnable/running 节点；retry 耗尽使用
`failed_retries_exhausted`。projector 不写库；CLI 文本、JSON 与 breadcrumb
从同一 query model 渲染。

### REQ-05. 极简 `tc init`

幂等创建 `.taskcraft/` 目录、打开 DB 并应用迁移；已初始化时只做幂等检查，
不覆盖用户内容。config 与 hook 安装不属于本任务。

### REQ-06. 最小 L1 命令面

`tc task new --title --level 1 --reason [--facts]`（只建卡，返回 queued）、
`tc run <task> [--node execute-1]`（唯一激活入口，同一事务写激活事实并创建
或领取首个 attempt，输出 command result 与纯数据简化 Node Brief）、
`tc run complete <task> --result <path|json|stdin>`（同一事务满足 execute 与
record，可到 done）、`tc task cancel <task> --reason`、`tc status [--json]`、
`tc task show <task> [--json]`、`tc task next <task> [--json]`。根命令
`tc` 在恰有一个 active task 时提供无 task id 的快捷 next。所有命令支持
`--json`；写命令失败非零退出并给稳定 code、impact 与一条 remediation。

### REQ-07. Command result / error contract

成功与失败结果遵循 `tc-command-result/v1` 结构；错误使用 `TC_TASK_*` /
`TC_LIFECYCLE_*` / `TC_REVISION_*` / `TC_EVIDENCE_*` / `TC_STORE_*` 前缀与
现有 taxonomy 对齐。remediation 只引用 CLI 或用户输入动作。breadcrumb 遵循
`development/contracts/breadcrumb.schema.json`。

### REQ-08. 同源渲染

text 与 JSON 输出、breadcrumb 都从同一 query model 渲染，无第二套状态推导。

### REQ-09. Fixtures

交付：L1 pass（完整闭环到 done）、验证缺失（缺 minimum validation 不能投影
done）、五状态投影（queued/active/waiting/done/cancelled）、revision
conflict、失败事务回滚（无部分事实/孤立 attempt）、cancel、retry exhaustion
（`failed_retries_exhausted` → waiting）。fixtures 放
`development/contracts/fixtures/`，只增不改既有文件。

### REQ-10. 测试与验证

- 合同测试：command result / breadcrumb / result schema 与实现一致。
- reducer 与事务测试（单组硬超时 60 秒）。
- CLI 集成测试（spawn `dist/cli.js`，pretest 先 build）。
- 真实本地 smoke：临时目录完整走 `init -> task new -> run -> run complete`
  到 done，及 cancel / 冲突路径。
- 提交前 `pnpm check` 全绿、`git diff --check` 干净。

### REQ-11. 非目标

- 不实现 review 命令与 L2/L3 图编译（Task 03/05）。
- 不实现 `task wait` / `task resume` / `run retry` / `task evidence add` 命令
  （reducer 语义与 fixtures 覆盖，命令留给后续任务）。
- 不实现 Adapter / Hook / Watch / Web（Task 04/06）。
- 不引入 ORM、bundler、workspace、DI 框架或第二套状态机。

## Acceptance Criteria

- [ ] `tasks` 不保存公开 status；删除只读输出后可从 SQLite 重建相同 status/next。
- [ ] 失败事务不产生部分事实、孤立事件或孤立 attempt。
- [ ] observation（`agent_runs`）的 finished 不能直接令任务完成。
- [ ] required obligation 只能由目标 attempt 的有效 evidence 满足。
- [ ] 缺少最小验证时 L1 不能投影为 done。
- [ ] 文本、JSON 与 breadcrumb 从同一 command result / query model 渲染。
- [ ] 并发冲突（CAS 不匹配）返回稳定错误（`TC_REVISION_CONFLICT`）与唯一恢复动作。
- [ ] `tc init` 幂等；已初始化不覆盖已有内容。
- [ ] `task new --level 2/3` 返回显式稳定错误，不静默降级。
- [ ] 失败命令非零退出，包含稳定 code、impact 与 remediation。
- [ ] 新增 JS/TS 文件有效行 ≤ 400；`pnpm check` 全绿；`git diff --check` 干净。

## Child Task Map

| 子任务 | 交付物 | 独立可检查点 |
| --- | --- | --- |
| `store-transaction` | 事务封装、revision/CAS 守卫、query model | 事务回滚无部分事实；CAS 冲突稳定错误；查询只读 |
| `reducer-projector` | L1 内置图、单 reducer、单 projector、fixtures | 五状态推导；obligation/evidence 规则；reducer 原子写 |
| `l1-cli-smoke` | 命令面、command result、Node Brief、同源渲染、smoke | L1 真实闭环到 done；JSON/text 一致；退出码契约 |

依赖顺序：`store-transaction` → `reducer-projector` → `l1-cli-smoke`；顺序写入
各子任务 `implement.md`，父任务负责共享 fixture、接口一致性与最终纵切验收。

## Notes

- 规划必须从真实 L1 用户路径反推最小内核：先定事务边界、projector 不变量与
  稳定错误，再拆实现。
- 子任务在各自 `prd.md` / `design.md` / `implement.md` 中细化；本文件是源需求集。
