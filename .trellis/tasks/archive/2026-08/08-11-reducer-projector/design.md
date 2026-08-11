# Design: Reducer and projector

## L1 Built-in Graph（静态常量，`src/core/lifecycle/l1.ts`）

```ts
nodes:
  execute-1  kind=execute  title="Execute"  procedureRef="l1:execute"
             objective 来自任务 objective_md
             outputSchema = execute result schema
  record-1   kind=record   title="Record"   procedureRef="l1:record"
             outputSchema = record result schema
edges:
  execute-1 -> record-1   condition={"kind":"always"}
obligations (duty=required):
  execute-1:
    requested-outcome-produced   evaluator: 存在属于该 execute attempt 的 evidence
    minimum-validation-recorded  evaluator: 存在属于该 attempt 且 type="validation" 的 evidence
  record-1:
    result-and-scope-retained    evaluator: record result_json 已写入
```

revision 1 写入时：`reason_code='initial'`、`compiler_version='tc-l1/1'`、
`facts_digest`/`policy_digest` 用 SHA-256 摘要（facts 为空对象时摘要为空串的
hash，语义稳定即可）、`created_by` 取命令 actor。

## Result Schemas（静态 JSON Schema，Draft 2020-12）

- execute result：
  ```json
  {
    "type": "object",
    "required": ["summary", "evidence"],
    "properties": {
      "summary": {"type": "string", "minLength": 1},
      "evidence": {"type": "array", "items": {
        "type": "object",
        "required": ["type", "reference", "summary"],
        "properties": {
          "type": {"type": "string", "enum": ["validation", "test", "artifact", "note"]},
          "reference": {"type": "string", "minLength": 1},
          "summary": {"type": "string", "minLength": 1},
          "digest": {"type": "string"}
        }
      }},
      "record": {"$ref": "#/$defs/record"}
    },
    "$defs": {"record": { ... record schema 本体 ... }}
  }
  ```
  说明：`run complete` 一次提交 execute result，其中可选 `record` 段（含
  summary/scope 变更/残余风险）在同一事务满足 record obligation——这是
  cli.md "run complete 可以同一事务满足 execute 与 record" 的实现。
  **实现裁决（与冻结合同冲突后按 contract 为准）**：storage.sql 的
  `obligation_results_evidence_owner_insert` trigger 要求 satisfied 的
  evidence 必须属于同 node、同 revision 的 attempt，execute evidence 不能
  满足 record-1 obligation（会 ABORT）。因此 record 段存在时 reducer 在
  同一事务物化 finished/success 的 record-1 attempt（result_json=record
  段）与归其所有的 note evidence，再写 record obligation satisfied。
  record 段缺失时 record obligation 保持 pending，任务不能 done。
- record result：`{ summary, changedScope?, residualRisks? }`（summary 必填）。

## Reducer Command Semantics

所有命令入口：`withTransaction(db, () => { const snap = checkRevision(...);
...; const seq = nextTaskSeq(...); insert facts; insert event(task_seq=seq+1,
post_task_revision=snap.revision+1); return ...; })`。

- **taskNew(db, input)**：校验 level=1（否则 `TC_TASK_LEVEL_UNSUPPORTED`）、
  reason 非空、title 非空；生成 id（`T-<N>`：`SELECT COUNT(*)+1 FROM tasks`
  起始 1，冲突重试一次——单进程 better-sqlite3 串行写，计数在事务内安全）；
  写 tasks 行（revision=1）、lifecycle 四表（revision 1）、event
  `task.created`。不写激活事实。返回 snapshot + next=`run <id>`。
- **run(db, taskId, expectedRevision?, nodeId?, host?)**：task 必须 queued
  （已激活则按"已激活任务的后续 run 只处理目标 node attempt"语义处理——
  L1 只有 execute-1，重复 run 返回现有 attempt 的 Node Brief）；写
  `activated_at`、创建 execute-1 attempt（status=created、attempt_number=1、
  actor_instance_id=host 或默认 "cli"）、event `task.activated`。返回 Node
  Brief（objective、obligations、result schema、登记命令）。
- **runComplete(db, taskId, attemptId?, result, expectedRevision?)**：校验
  attempt 属于当前 revision 且 node 为 execute-1（引用校验）；Ajv 校验
  result 过 execute schema（失败 `TC_LIFECYCLE_RESULT_INVALID`，不写任何
  事实）；写 evidence 行（每条绑定 attempt）、attempt outcome=success、
  `obligation_results`：两条 execute obligation 校验 evaluator 后 satisfied
  （`satisfied_by_evidence_id` 必填，触发 storage.sql trigger 保护）；result
  含 `record` 段时同一事务物化 finished/success 的 record-1 attempt +
  归其所有的 note evidence，再写 record obligation satisfied（见 Result
  Schemas 的实现裁决——execute evidence 无法满足 record obligation）；
  event `attempt.finished`。
- **cancel(db, taskId, reason, expectedRevision?)**：task 未取消否则
  `TC_TASK_ALREADY_CANCELLED`；写 `cancelled_at`/`cancel_reason`；活跃
  attempt（created/running）结束为 cancelled；event `task.cancelled`。
- **失败 attempt 与 retry exhaustion（语义，无命令）**：reducer 支持将
  attempt 写为 failed（供后续命令/测试使用，本任务不暴露 CLI）；连续失败
  达到 retry_policy 上限（L1 默认 3）时写 open blocker
  `failed_retries_exhausted`。该语义通过 fixtures 与测试验证。

审计 event 统一 `post_task_revision = 写后 revision`、`occurred_at` ISO 时间。

## Projector

```ts
project(db, taskId): Projection
// 输入：query model 快照（task、attempts、evidence、obligation results、
//       blockers、lifecycle graph）
// 输出：{ status, waitingReason, nodeStatuses, runnableNodes, runningNode,
//         doneObligations/totalObligations, next: CommandString | null,
//         breadcrumb: BreadcrumbV1 }
```

推导规则（父 design Projector Invariants）：
1. `cancelled_at` 非空 → cancelled（next=`tc task show`）。
2. `activated_at` 为空 → queued（next=`run`）。
3. record obligation satisfied 且全部 required satisfied → done（next=null）。
4. open blocker 且无 runnable/running → waiting，waitingReason=blocker
   waiting_reason（多 blocker 时取创建最早者，next=显式 remediation 或 null）。
5. 有 running attempt 的节点 → active（node=running）。
6. 存在 runnable node（前置节点 satisfied、自身无 satisfied 结果、无
   running attempt）→ active（next=`run complete` 若存在 running/runnable
   execute attempt，否则 `run --node`）。
7. 其余 → active（下一个 runnable 无）边缘情况归 waiting 的补集，测试覆盖。

next 唯一性：execute attempt 存在（created/running）→ `run complete`；
否则 `run <id> --node execute-1`。done/cancelled/waiting 按上表。

## Fixtures（`development/contracts/fixtures/`）

| fixture | 内容 | 验证点 |
| --- | --- | --- |
| `l1-pass.fixture.json` | 完整 L1 事实：task+图+attempt+evidence+obligation results | projector → done；next=null |
| `validation-missing.fixture.json` | 缺 type=validation evidence | 不能 done（active 或 waiting） |
| `five-status.fixture.json` | 五条任务：queued/active/waiting/done/cancelled | 五状态投影一致 |
| `revision-conflict.fixture.json` | 旧 expectedRevision | reducer 抛 TC_REVISION_CONFLICT |
| `transaction-rollback.fixture.json` | 失败事务场景 | 回滚后无部分事实 |
| `cancel.fixture.json` | cancel 事实 + attempt 终止 | cancelled 投影、attempt cancelled |
| `retry-exhaustion.fixture.json` | 连续失败 + open blocker | waiting(failed_retries_exhausted) |

fixture 是 JSON 事实快照（参照 l2-task.fixture.json 风格），测试用 helper
导入临时 DB 后跑 projector/reducer 断言。

## Tests

- reducer：taskNew 写图与事件（task_seq 连续）、run 激活 + attempt 创建、
  runComplete 原子满足两 obligation、坏 result 不写任何事实、
  evidence 归属错误 → `TC_EVIDENCE_REF_INVALID`、CAS 冲突、cancel 幂等边界。
- projector：五状态 fixture、waitingReason、next 唯一、observation
  （agent_runs finished）不驱动 done。
- 合同：fixture JSON 可解析；breadcrumb 构造通过 `breadcrumb.schema.json`
  校验（`createContractValidators`）。
