# Waiting resume retry loop

## Goal

实现 `tc task wait` / `tc task resume` / `tc run retry` / attempt failure
公开路径，覆盖四类 waitingReason，使真实 CLI 可完成
`active -> waiting -> active -> done` 闭环（含新进程恢复）。

## Requirements

### REQ-01. taskWait

`tc task wait <id> --reason needs_input|needs_decision|blocked_dependency
--message <text>`：写 open blocker（kind 与 reason 对应；blocked_dependency
可带 node）+ 审计事件；projector 输出 waiting + waitingReason + remediation。

### REQ-02. taskResume

`tc task resume <id>`：对应 blocker 已具备解决事实（用户回答写为 constraint
fact 或明确 `--resolve`）时写 blocker resolved + 事件；未解决则拒绝（稳定
错误 + 提示先写 fact）。CAS 校验。

### REQ-03. runRetry / failure 公开路径

`tc run fail <id> --attempt <id> --reason <text>`：attempt 标记 failed
（reducer 既有 failure 语义公开化）；`tc run retry <id> --attempt <id>
--reason <text>`：为同节点创建 successor attempt（旧 attempt 保持 failed）；
重试预算耗尽（L1 默认 3）写 `failed_retries_exhausted` blocker →
waiting。CAS + 事件连续性。

### REQ-04. Tests

四类 waitingReason 的 open/resolve 生命周期；`active -> waiting -> active ->
done` CLI 集成（含新进程恢复：spawn 两次 CLI）；retry successor 编号；
耗尽 blocker；CAS 冲突；失败零写入。

## Acceptance Criteria

- [ ] 真实 CLI 可完成 active -> waiting -> active -> done（两次独立进程）。
- [ ] blocker 开/解有原子事件 + CAS 测试。
- [ ] retry 耗尽 → waiting(failed_retries_exhausted)。
- [ ] 新增文件有效行 ≤ 400；`pnpm check` 全绿。

## Notes

- 依赖父 design 的 blocker reducer 与公开命令；storage.sql 的 blockers 表
  已含所需列（kind/waiting_reason/status/remediation_command）。
