# Design: L2 review reducer semantics

## Interfaces（新增/修改）

```ts
// src/core/reducer.ts 桶文件追加导出
reviewStart(db, input: ReviewStartInput): ReviewResultData
reviewPass(db, input: ReviewPassInput): ReviewResultData
reviewChanges(db, input: ReviewChangesInput): ReviewResultData
reviewReplan(db, input: ReviewReplanInput): ReviewResultData

// inputs
ReviewStartInput   { taskId, expectedRevision?, nodeId="review-1", purpose,
                     reviewedAttemptId, capability, independenceStatus,
                     host?, observedHostSessionId?, actorInstanceId? }
ReviewPassInput    { taskId, expectedRevision?, attemptId, reviewedAttemptId,
                     evidence: { type, reference, summary, digest? }[],
                     finding? }
ReviewChangesInput { taskId, expectedRevision?, attemptId, reviewedAttemptId,
                     finding }
ReviewReplanInput  { taskId, expectedRevision?, attemptId, reviewedAttemptId,
                     reasonCode, finding }
```

## Review Tables Usage（storage.sql 对齐）

- review link 写入列：review_attempt_id（= 新 review attempt id）、
  reviewed_attempt_id、review_purpose、capability、independence_status、
  reviewer_principal_id（actor）、observed_host_session_id、created_at。
- trigger 兜底：purpose 与 kind 不匹配（delivery→execute）会 ABORT——reducer
  前置校验并返回 `TC_REVIEW_PURPOSE_MISMATCH`（稳定错误优先于 SQLite 原始
  错误）。
- observed-distinct 的 CHECK：capability=host-observed 且
  observed_host_session_id 非空——reducer 前置校验返回
  `TC_REVIEW_INDEPENDENCE_INVALID`。
- review_findings：severity=blocking（changes/replan）或 advisory（pass 带
  finding）、disposition=open、evidence_refs_json、created_at。

## 事务边界

- 四命令统一 `withTransaction`：先 `checkRevision`（缺省用快照 revision），
  再校验引用，再写事实 + 一条审计 event（task_seq 连续）。
- reviewChanges 的 successor attempt：attempt_number = 该节点当前最大
  attempt_number + 1（per revision、per node）。
- reviewReplan 的 revision 切换：新 revision 的 attempt 编号从 1 重新开始
  （node_attempts UNIQUE(task_id, lifecycle_revision, node_id,
  attempt_number) 是 per-revision 的）；supersede 只影响 created/running，
  finished/failed/cancelled 不动；旧 obligation_results 保留。
- 失败路径一律零写入（回滚），无部分事实。

## Projector next 推导（修改 project()）

```text
按节点状态与 kind 生成 next（active 分支）：
  running frame/execute/record -> tc run complete <id> --node <node>
  running review（attempt created/未完结）-> tc review pass <id>
      --attempt <review-attempt-id> --reviewed-attempt <execute-attempt-id>
  runnable review（execute satisfied、无 review attempt）-> tc review start <id>
      --node review-1 --purpose delivery --reviewed-attempt <execute-attempt-id>
  runnable frame/execute/record -> tc run <id> --node <node>
```

review 节点 satisfied 判定：存在 outcome=passed 的 review attempt。
review-1 runnable 的入边要求：execute-1 satisfied（同 revision）。

## Error Codes（新增到 ERROR_CODES）

TC_REVIEW_REF_INVALID、TC_REVIEW_ALREADY_PASSED、TC_REVIEW_PURPOSE_MISMATCH、
TC_REVIEW_INDEPENDENCE_INVALID、TC_REQUIRED_EVIDENCE_MISSING。

## Fixtures（development/contracts/fixtures/，只增不改）

| fixture | 场景 | 验证点 |
| --- | --- | --- |
| l2-pass | 完整 L2 事实到 done | done；record/execute/review/frame 均 satisfied |
| review-changes-requested | blocking finding + successor execute attempt | active；next 指向新 execute |
| review-replan-required | 新 revision + superseded 旧 attempt | active 新 revision；旧 attempt superseded 可查询 |
| review-same-actor | independence=same-actor + context-only | 披露正确投影 |
| review-unverified | independence=unverified + manual-attach | 披露正确投影 |
| review-missing-evidence | pass 缺 evidence 场景 | reducer 零写入 + TC_REQUIRED_EVIDENCE_MISSING |

## Tests

- reducer：reviewStart 写 link（trigger 匹配）、reviewPass 原子满足
  （evidence gate / 零写入）、reviewChanges successor、reviewReplan 事务
  （supersede 原子、无部分事实、事件连续性）、CAS。
- projector：三 outcome 后 next 推导、review 节点状态、done 不变式。
- 合同：fixture 可导入、breadcrumb 仍过 schema。
