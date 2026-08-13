# Design: waiting/resume/retry

## Reducer 语义（src/core/reducer/blocker.ts 或拆分）

```ts
taskWait(db, { taskId, expectedRevision?, reasonCode, message, nodeId? })
// 写 blockers(open, kind/waiting_reason 按 reasonCode) + event task.waiting
taskResume(db, { taskId, expectedRevision?, resolve?: boolean })
// 前置：存在 open blocker；resolve=true 或该 blocker 已有满足事实
//       （如 constraint fact）→ 写 resolved + event task.resumed
runFail(db, { taskId, expectedRevision?, attemptId, reason })
// attempt(created/running) -> failed + event attempt.failed
runRetry(db, { taskId, expectedRevision?, attemptId, reason })
// 前置：attempt failed/superseded 或 observation stale
// 同节点 successor attempt（attempt_number 全局递增，沿用 Task 03 模式）
// 达到 retry_policy 上限（L1: 3）→ open blocker failed_retries_exhausted
```

## 公开命令

- `tc task wait <id> --reason <code> --message <text> [--node <id>]`
- `tc task resume <id> [--resolve]`
- `tc run fail <id> --attempt <id> --reason <text>`
- `tc run retry <id> --attempt <id> --reason <text>`

remediation_command 由 reducer 生成（wait → `tc task resume <id>` 或
`tc task fact add ...`；retry exhaustion → `tc run retry ...` 或
`tc task cancel`）。

## Blocker 状态机

open(created_at) → resolved(resolved_at, 事件) ；同 task 同时仅一个 open
blocker 生效（projector 取最早创建）；resume 后 projector 恢复 runnable
推导。

## Tests

- reducer：wait/resume/retry/fail 事务、事件连续性、CAS、耗尽 blocker。
- CLI：双进程 `active -> waiting -> active -> done`；`--resolve` 与 fact
  满足两种 resume 路径。
