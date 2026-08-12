# Design: L2 tracked workflow and review feedback

## Structural Judgment

复用 Task 02 内核（withTransaction / checkRevision / project / reducer 四命令 /
query model），在 `src/core/lifecycle/` 增 L2 图，`src/core/reducer/` 增 review
四命令（reviewStart / reviewPass / reviewChanges / reviewReplan），projector 增
按 node kind 的 next 推导，CLI 增 `tc review` 子命令。不新增表（storage.sql 已含
review_links / review_findings），不引入平行状态机。

## L2 Built-in Graph（src/core/lifecycle/l2.ts）

```text
nodes:   frame-1 (kind=frame)   ->  outputSchema: { objective, scope, acceptance }
         execute-1 (kind=execute) -> 复用 L1 execute schema（含 evidence 与 record 段）
         review-1 (kind=review)  ->  复用 execute evidence 契约（无独立 result schema，
                                      outcome 由 review 命令写入）
         record-1 (kind=record)  ->  复用 L1 record schema
edges:   frame-1 -> execute-1
         execute-1 -> review-1
         review-1 -> record-1
obligations (required):
  frame-1:   frame-completed          evaluator: frame attempt result_json 存在（结构校验过）
  execute-1: requested-outcome-produced、minimum-validation-recorded（同 L1）
  review-1:  review-completed         evaluator: 存在 outcome=passed 的 review attempt
  record-1:  result-and-scope-retained（同 L1）
```

`task new --level 2`：物化 L2 图（revision 1）；level 1 保持 L1 图；level 3
继续 `TC_TASK_LEVEL_UNSUPPORTED`。L1/L2 图常量共享 evaluator 与 schema。

## Review Command Semantics（src/core/reducer/review-*.ts）

### reviewStart(db, input)

前置：task active；review-1 runnable（execute satisfied 且无已存在的 review
attempt）；`reviewedAttemptId` 属于当前 revision 的 execute attempt（引用校验
失败 `TC_ATTEMPT_REF_INVALID`）；`purpose` 与 node kind 匹配（delivery→execute，
不匹配由 storage.sql trigger 兜底 + reducer 前置校验返回稳定错误）；CAS。

写集合（一个事务）：review attempt（kind=review、status=created、attempt_number
按节点计数）+ review link（capability / independence_status；`observed-distinct`
必须 host-observed + observed_host_session_id 非空，违反返回稳定错误）+ 审计
event。不写 outcome。

### reviewPass(db, input)

前置：review attempt 属于当前 revision 且已创建（未完结）；`reviewedAttemptId`
与 link 一致；`evidence` 引用存在且属于当前 revision 的 review attempt（evidence
gate：L2 要求 review 至少有 1 条 evidence——如 reviewer 记录 diff/验证/结论）；
CAS。

写集合：review attempt outcome=passed + status=finished + finished_at +
evidence 行（绑定 review attempt）+ review-1 obligation satisfied +
advisory finding（可选，--finding 非空时 severity=advisory）+ 审计 event。
next：record-1（`tc run --node record-1`）。

### reviewChanges(db, input)

前置：review attempt 已创建且未完结；CAS。

写集合：blocking finding（severity=blocking、disposition=open）+ 为被审核
node kind（execute）在当前 revision 创建 successor attempt
（attempt_number+1、status=created；原 execute attempt 保持 finished，不改
outcome，不建 resolution 表）+ **review attempt 完结为
finished/changes_requested**（否则 review-1 永远有 running attempt，后续
无法再 review start，闭环死锁）+ 审计 event。scope/contract 不变（不写新
revision）。next：新 execute attempt 的 `tc run complete`（不带 --node，
默认 execute-1）。

### reviewReplan(db, input)

前置：review attempt 已创建且未完结；`reasonCode` 为 storage.sql 枚举
（replan_required / scope_changed / contract_changed / level_changed /
manual_revision）；CAS。

写集合（一个事务）：
1. blocking finding；
2. 新 lifecycle revision（reason_code、reason=--finding、compiler_version、
   facts/policy digest、change_summary_json=old/new diff、created_by）；
   新 revision 复用稳定 node id（frame-1/execute-1/review-1/record-1），
   obligations 同构；
3. `tasks.current_lifecycle_revision` 更新（revision 仍自增）；
4. 旧 revision 的 created/running attempt 全部 → status=superseded、
   outcome=superseded（含 review attempt；finished 历史保留；节点停止接受
   新 attempt）；
5. 审计 event——**事件引用旧 revision**（events 复合 FK
   attempt_id/task_id/lifecycle_revision/node_id 要求与 attempt 精确匹配）。

next：新 revision 首个 runnable node（frame-1 若未完成则 frame，否则按图序）。
旧 revision 的 attempt/evidence/finding 全部可查询（projector 与 query model
不隐藏历史）。

## Projector Extension

- 节点状态：frame/execute/record 与 L1 相同（satisfied/running/runnable/
  blocked）；review-1 增加"review 已创建未完结"视为 running 类。
  **running 优先于 satisfied**：reviewChanges 后 execute-1 同时存在
  finished/success 旧 attempt 与 created successor——必须投影 running
  （next 指向 `tc run complete`），否则 next 落到旧 attempt 死胡同。
- **`run` 拒绝 review 节点**：review 节点只能经 `tc review start` 创建
  attempt（run claim 会产生无 review link 的 attempt，projector 的
  reviewPassCommand 会崩溃）；`run --node review-1` 返回
  `TC_ATTEMPT_REF_INVALID`。
- next 按 node kind 生成：
  - frame/execute/record runnable → `tc run <id> --node <node>`
  - review-1 runnable（execute satisfied、无 review attempt）→
    `tc review start <id> --node review-1 --purpose delivery
    --reviewed-attempt <当前 revision 的 execute attempt id>`
  - review attempt 已创建未完结（running）→
    `tc review pass <id> --attempt <review-attempt> --reviewed-attempt
    <execute-attempt> [--evidence <id>]`
  - running execute/frame/record → `tc run complete <id> --node <node>`
- done：record satisfied + 当前 revision 全部 required satisfied（不变）。
- 五状态与 waiting 逻辑不变；`agent_runs` 永不参与。

## Error Taxonomy（新增）

| code | 场景 | remediation |
| --- | --- | --- |
| `TC_REVIEW_REF_INVALID` | reviewedAttemptId 不属于当前 revision 的 execute attempt | `tc task show <id> --json` |
| `TC_REVIEW_ALREADY_PASSED` | review attempt 已完结又 pass/changes/replan | `tc task show <id> --json` |
| `TC_REVIEW_PURPOSE_MISMATCH` | purpose 与被审核 attempt kind 不匹配 | 用 delivery 审核 execute attempt |
| `TC_REVIEW_INDEPENDENCE_INVALID` | observed-distinct 缺 host-observed/会话 id | 补 host 关联或如实填 unverified/same-actor |
| `TC_REQUIRED_EVIDENCE_MISSING` | review pass 缺 evidence gate | `tc task evidence add`（本任务不实现该命令 → 提示用 review pass 前置的 evidence 参数） |

错误对象沿用 TaskcraftError 结构；CAS 冲突沿用 `TC_REVISION_CONFLICT`。

## Fixtures（新增，只增不改既有）

l2-pass（完整 L2 闭环事实 → done）、review-changes-requested（successor
attempt + blocking finding → active 指向新 execute）、review-replan-required
（新 revision + superseded 旧 attempt → active 新 revision 首个 runnable）、
review-same-actor / review-unverified（independence 披露正确投影）、
review-missing-evidence（pass 缺 evidence → 零写入）。

## CLI（src/commands/review-*.ts + cli.ts 注册）

`tc review start|pass|changes|replan <id> [flags...]`；全局 `--json`；
`--expected-revision` 沿用 optsWithGlobals 模式；失败非零退出 + 三件套。
L2 闭环命令序列（cli.md §4 L2 示例一致，frame/execute/record 用 run/complete，
review 用 review start/pass）。

## Attempt ID 与义务满足（实现裁决，revision 切换后生效）

- **attempt id 按节点全局递增**：`node_attempts.id` 是全局 TEXT 主键，而
  attempt_number 编号只按当前 revision 计算会在 replan 后与新 revision 撞
  主键。编号（id 与 attempt_number）改为按节点跨 revision 全局单调递增；
  `UNIQUE(task_id, lifecycle_revision, node_id, attempt_number)` 依然成立
  （同 revision 不可能同号），`getAttempts` 按 (attempt_number, id) 排序稳定。
  新 revision 的 attempt_number 不再从 1 复位。
- **satisfyObligation 幂等 no-op**：`obligation_results` 主键为
  (task_id, lifecycle_revision, node_id, obligation_id)，changes 流 successor
  重做 execute 时同 revision 同义务已满足，重复 INSERT 必撞主键——满足前
  SELECT 预检，已存在则 no-op。唯一被吞场景就是"本 revision 本节点本义务已
  满足"，不掩盖 attempt/revision 不匹配（错 revision 会插新行而非 no-op）。
- **writeRecordResult 的 attemptNumber 必须与全局 id 一致**（同 revision
  二次 record 写入时硬编码 1 会撞 UNIQUE）。

## Compatibility & Rollback

- 只增改 src/ 与新增 fixtures；storage.sql / schemas / 既有 fixtures / specs
  不动。
- review 语义与 trigger 冲突时以 contract 为准（Task 02 先例）。
- 每子任务完成 `pnpm check` 全绿为提交门槛。
