# Design: Taskcraft store kernel and L1 vertical slice

## Structural Judgment

任务拆为三个子任务，按依赖顺序执行：`store-transaction` → `reducer-projector`
→ `l1-cli-smoke`。父任务不做直接实现，负责接口一致性、共享 fixture 与最终纵切
验收。边界：不创建 Adapter/Hook/Watch 空壳，不引入 ORM/bundler。

## Data Flow

```text
CLI command
  -> validate input (Ajv, where schema exists)
  -> read current snapshot (query model)
  -> CAS check (expectedRevision vs tasks.revision)
  -> reducer(command, snapshot)
       - validate references (task/node/attempt/evidence ownership)
       - validate lifecycle contract & outcome rules & result schema
       - write canonical facts + one audit event (task_seq contiguous)
       - commit in one BEGIN IMMEDIATE transaction; any failure -> ROLLBACK
  -> projector(snapshot) derives status / waitingReason / runnable / next
  -> render: text | JSON (command result tc-command-result/v1) | breadcrumb
```

`tasks` 不保存公开 status。所有只读视图（text、JSON、breadcrumb、Node Brief）
只消费同一个 query model + projector 输出。

## Module Shape

```text
src/
  cli.ts                      # Commander 根命令 + 子命令注册（已存在，扩展）
  commands/                   # 每个命令一个文件：init / task-new / run /
                              #   run-complete / task-cancel / status /
                              #   task-show / task-next
  store/
    database.ts               # openDatabase（已存在，不动）
    migrations.ts             # applyMigrations（已存在，不动）
    transaction.ts            # BEGIN IMMEDIATE / COMMIT / ROLLBACK 封装
    revision-guard.ts         # CAS 校验：读 revision -> 匹配 -> 写
    query.ts                  # query model：只读查询（task、attempts、
                              #   evidence、obligations、blockers、events）
  core/
    lifecycle/l1.ts           # L1 内置图：nodes / edges / obligations /
                              #   result schemas / evaluators（静态常量）
    reducer.ts                # 单 reducer：taskNew / run / runComplete / cancel
    projector.ts              # 单 projector：五状态 + runnable + next
    command-result.ts         # tc-command-result/v1 构造与错误映射
    errors.ts                 # 稳定错误类型 + TC_* code 常量
    breadcrumb.ts             # tc-breadcrumb/v1 构造（按 contracts schema）
  contracts/
    schemas.ts                # createContractValidators（已存在，扩展 L1 result schema）
```

依赖方向：`commands -> reducer/projector -> store`；`core` 不 import CLI；
`store` 不 import `core`。单文件有效行 ≤ 400（超过则拆）。

## L1 Built-in Lifecycle

```text
nodes:   execute-1 (kind=execute)
         record-1  (kind=record)
edges:   execute-1 -> record-1  (condition always)
obligations (required):
  execute-1: requested-outcome-produced   -> evidence exists on the execute attempt
             minimum-validation-recorded  -> evidence of type "validation" exists
  record-1:  result-and-scope-retained    -> record result_json present
review: 不包含（L1 为 optional，非 required）
```

- revision 1（initial）materialize 此图；`lifecycle_revisions` /
  `lifecycle_nodes` / `lifecycle_edges` / `obligation_definitions` 四表按
  `storage.sql` 写入，沿用其 append-only trigger 保护。
- execute 与 record 的 `output_schema_json` 为静态 JSON Schema
  （Draft 2020-12），由 `createContractValidators` 编译。
- result schema 契约：`run complete` 的 result JSON 必须通过目标节点的
  output schema；execute result 可携带 `evidence` 段（type/reference/
  summary），reducer 为每条 evidence 建 `evidence` 行并绑定 attempt。
- `minimum-validation-recorded` 的 evaluator：execute attempt 至少一条
  `type="validation"` 的 evidence（stale 判定：evidence 必须属于当前 revision
  的目标 attempt——满足"required obligation 只能由目标 attempt 的有效 evidence
  满足"）。

## Reducer Command Semantics (L1 subset)

| 命令 | 前置事实 | 原子写集合 | 成功后的 next |
| --- | --- | --- | --- |
| `task new` | 已 init；level=1；reason 必填 | task、revision 1（initial）、L1 图四表、obligations、审计 event | `run <task>` |
| `run` | task 存在且 queued（首次）；或当前 revision 存在 runnable node；CAS 匹配 | 激活事实（`activated_at`）、runnable node attempt（created，L1 为 execute-1 或 record-1；blocked/satisfied/不存在的节点拒绝）、审计 event | `run complete` + Node Brief |
| `run complete` | attempt 属于当前 revision；result 通过目标节点 schema；CAS 匹配 | attempt outcome、evidence 行、execute obligations satisfied（校验后）；**execute-1 完成时 result 含 record 段则同一事务物化 record-1 attempt 闭合**；record-1 也可独立 complete（record schema + 自动 note evidence + 满足 result-and-scope-retained）；审计 event | `done` 或下一节点命令 |
| `cancel` | task 未取消；CAS 匹配 | `cancelled_at` + `cancel_reason`、活跃 attempt 终止（cancelled）、审计 event | 只读 `task show` |

- `run complete` 的"同一事务满足 execute 与 record"：execute result 的
  可选 `record` 段存在时，reducer 在同一事务物化 finished/success 的
  record-1 attempt（result_json=record 段）与归其所有的 note evidence，
  再写 record obligation satisfied。**为什么必须物化 record attempt**：
  storage.sql 的 `obligation_results_evidence_owner_insert` trigger 要求
  satisfied 的 evidence 必须属于同 node、同 revision 的 attempt，
  execute evidence 无法满足 record-1 obligation（会 ABORT）；这同时满足
  trigger 与"required obligation 只能由目标 attempt 的有效 evidence 满足"
  的验收标准。record 段缺失时 record obligation 保持 pending，任务不能
  done。projector 从 obligation_results 推导 done。
- attempt 失败路径（本任务命令面不含 retry）：reducer 语义保留——失败
  attempt 不产生 outcome 满足；retry exhaustion 通过 fixtures 构造
  （连续失败写 `failed_retries_exhausted` blocker）验证 projector 的
  waiting 推导；`run retry` / `task wait` / `resume` 命令不在本任务实现。
- 引用校验：evidence 的 `node_attempt_id` 必须属于当前 task/revision/node；
  违反返回 `TC_EVIDENCE_REF_INVALID`。CAS 冲突返回 `TC_REVISION_CONFLICT`，
  响应含最新 `tc status --json` 重读命令。

## Projector Invariants

```text
status 优先级：cancelled > done > waiting > active > queued

queued    : 未激活（activated_at IS NULL）
active    : 已激活 且 存在 runnable 或 running node
waiting   : 已激活 且 无 runnable/running node 且 存在 open blocker
            waitingReason = blocker.waiting_reason（typed）
done      : record obligation satisfied 且 当前 revision 全部 required
            obligations satisfied
cancelled : cancelled_at IS NOT NULL
```

- runnable node：存在入边已满足（前置节点 satisfied）且自身无 satisfied 结果、
  无 running attempt 的节点；有 running attempt 时节点状态为 running 且
  优先于 runnable 报告。
- next 唯一：running node 存在 → `tc run complete <id> [--node <node>]`
  （execute-1 省略 --node）；否则按图序第一个 runnable node →
  `tc run <id> --node <node>`；无 runnable 且 done → 无 next；cancelled →
  `tc task show`。**record 补交闭环**：execute 完成但 result 无 record 段时
  record obligation pending、record-1 runnable，next 为
  `tc run <id> --node record-1` → `tc run complete <id> --node record-1`，
  不允许把 next 指向已完成的 execute-1（死胡同）。
- observation 永不进入推导（`agent_runs` 不参与 status/obligation 计算）。
- done 判定必须满足"record 已完成且全部 required obligations satisfied"，
  与 architecture.md#5 一致。

## Error Taxonomy (Task 02 subset)

| code | 场景 | remediation 方向 |
| --- | --- | --- |
| `TC_TASK_NOT_FOUND` | task id 不存在 | `tc task list` |
| `TC_TASK_ALREADY_CANCELLED` | 重复取消 | `tc task show <id>` |
| `TC_TASK_LEVEL_UNSUPPORTED` | `--level 2/3`（图编译未交付） | 说明后续任务，不降级 |
| `TC_REVISION_CONFLICT` | expectedRevision 不匹配 | `tc status --json` 重读 |
| `TC_LIFECYCLE_RESULT_INVALID` | result 未过节点 schema | 返回 Node Brief 中的 result schema |
| `TC_EVIDENCE_REF_INVALID` | evidence 引用不属于目标 attempt/revision | 重建 evidence |
| `TC_REQUIRED_OBLIGATION_MISSING` | 缺 minimum validation 等 required evidence | `run complete` 补 evidence |
| `TC_STORE_TRANSACTION_FAILED` | 事务级失败（包裹 cause） | 重试或 `tc doctor` |
| `TC_STORE_*` | 沿用 Task 01 迁移/连接错误 | 不变 |

错误对象统一 `{ code, problem, impact, remediation }`；失败命令 stderr 输出
+ 非零退出码。

## Command Result / Breadcrumb Contract

- 成功/失败结构遵循 cli.md §8 的 `tc-command-result/v1` 字面结构
  （`ok` / `data` / `errors`）。
- 写命令成功时 `data` 含 `taskId`、`taskRevision`、`status`、`next`
  （命令字符串）、`waitingReason`（null 或 typed）、Node Brief（`run` 时）。
- breadcrumb 按 `breadcrumb.schema.json` 构造（takeover/task/next/
  detailCommand），`tc state --breadcrumb` 不在本任务命令面（breadcrumb 由
  `status` 与 `task show --json` 的渲染层复用同一 projector 数据）。
- text 与 JSON 渲染共用 projector 输出对象，禁止各自推导。

## Compatibility & Rollback

- 只新增文件；`storage.sql` / `lifecycle.schema.json` / `breadcrumb.schema.json`
  / `migrations/0001_initial.sql` 不改动（L1 图是运行时数据，不是 migration）。
- 若 L1 图或 reducer 语义与冻结合同冲突：回退到 Plan 修正
  （prd/design 是权威），不先改 contract。
- 每个子任务完成时 `pnpm check` 全绿为提交门槛；失败先修复再提交。
- 新 DB 文件在 `.taskcraft/` 下运行时生成；测试一律 `:memory:` 或临时目录。
