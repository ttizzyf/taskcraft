# Runtime observation and hook diagnostics

## Goal

补齐 Runtime observation 公开命令链（`tc run attach` / `tc run status`），
Hook 现场测试结果持久化，Watch Runtime/Diagnostics 展示同一来源。

## Requirements

### REQ-01. run attach / run status

- `tc run attach <id> --node <node> --host-run-id <id> [--host-session-id
  <id>]`：为当前 revision 的目标 node attempt 写 agent_runs 行
  （observation_status=pending/running，reducer 事务，CAS）；真实命令产生
  agent_runs。
- `tc run status <id>`：展示 attempt + observation 状态（host/run id/
  last seen/finish reason），只读。

### REQ-02. Observation 不驱动完成（公开复证）

attach 后 observation finished 不改变 task 投影（projector 不读
agent_runs——已有保证，CLI 集成测试复证：attach + 标记 finished → status
仍 active/按 attempt 推导）。

### REQ-03. Hook 测试结果持久化

test-hook 结果写 `.taskcraft/config.json` 的 `hookTests`（testedAt/
version/ok/enforced/failure）；`tc agent capabilities` 与 Watch
Diagnostics 展示同一来源（不重复检测）。

### REQ-04. Watch 同源

Watch Runtime 页面展示 agent_runs（由 run attach 产生）+ hookTests；
Diagnostics 展示 hook 失效/未注册/版本漂移（读 config.hookTests 与安装
状态）；无 fixture 插库。

## Acceptance Criteria

- [ ] `tc run attach` 产生 agent_runs；`tc run status` 展示同源。
- [ ] observation finished 不直接 done（公开路径复证）。
- [ ] hookTests 持久化且 Watch 与 CLI 同源展示。
- [ ] 新增文件有效行 ≤ 400；`pnpm check` 全绿。

## Notes

- 依赖 B（retry 用 observation stale 判定）与 C（hookTests 写入）的结果合同。
- 不新增表（storage.sql agent_runs 已有）。
