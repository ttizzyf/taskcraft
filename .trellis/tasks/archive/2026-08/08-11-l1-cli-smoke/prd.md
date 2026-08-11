# L1 CLI vertical slice

## Goal

把 store-transaction 与 reducer-projector 接成可执行的 L1 命令面：
`init -> task new -> run -> run complete` 完整闭环到 `done`，text/JSON/
Node Brief 从同一 query model 渲染，错误稳定可脚本化。

## Requirements

### REQ-01. Command Surface

- `tc init`：幂等创建 `.taskcraft/` + DB + 迁移；已初始化只做幂等检查。
- `tc task new --title <t> --level 1 --reason <r> [--facts <json|@path|@->]`：
  只建卡，返回 queued；`--level 2/3` 返回 `TC_TASK_LEVEL_UNSUPPORTED`。
- `tc run <task> [--node execute-1] [--host <host>]`：唯一激活入口，同一事务
  写激活事实并创建首个 attempt；输出 command result + 纯数据简化 Node Brief
  （objective、required obligations、result schema、登记命令）。
- `tc run complete <task> --result <path|json|stdin> [--expected-revision <n>]`：
  校验 result，同一事务满足 execute 与 record，可到 done。
- `tc task cancel <task> --reason <r>`、`tc status [--json]`、
  `tc task show <task> [--json]`、`tc task next <task> [--json]`。
- 根命令 `tc`：恰有一个 active task 时提供无 task id 的快捷 next。
- 所有命令支持 `--json`；失败 stderr + 非零退出。

### REQ-02. Command Result / Error Contract

成功与失败遵循 `tc-command-result/v1`；错误含稳定 code、impact、remediation；
写命令成功时 data 含 taskId/taskRevision/status/next/waitingReason（+ Node
Brief for run）。退出码：成功 0，命令/业务失败 1，内部错误 2（与 Commander
默认区分）。

### REQ-03. Same-source Rendering

text、JSON、Node Brief 只消费 projector + query model 输出，无第二套推导；
`task show --json` 的 data 可作为 text 渲染的同源输入。

### REQ-04. CLI Integration Tests

spawn `dist/cli.js`（pretest build 已保证产物最新）：init 幂等且不覆盖已有
内容；task new 拒绝 level 2/3；完整 L1 闭环到 done（临时目录）；cancel；
CAS 冲突（`--expected-revision` 错值）；JSON/text 一致；退出码契约；
`run complete --result @path` 与 stdin 两种输入。

### REQ-05. Real Smoke

临时目录真实执行 `init -> task new -> run -> run complete` 到 done，输出
breadcrumb 与 JSON 均可解析；作为提交前的本地验证步骤。

## Acceptance Criteria

- [ ] `init -> task new -> run -> run complete` 在临时目录端到端走到 done。
- [ ] text 与 JSON 输出字段同源一致；JSON 可通过对应 schema 校验。
- [ ] 失败命令非零退出，stderr 含稳定 code + impact + remediation。
- [ ] `init` 幂等，重复执行不报错也不覆盖 `.taskcraft/` 已有内容。
- [ ] `--level 2/3` 显式报错，不静默降级。
- [ ] `--expected-revision` 冲突返回 `TC_REVISION_CONFLICT` 与重读命令。
- [ ] 新增文件有效行 ≤ 400；`pnpm check` 全绿；`git diff --check` 干净。

## Non-goals

- 不实现 review / wait / resume / retry / evidence add 命令。
- 不实现 hook 安装、config 写入、Watch、Web（Task 04/06）。
- 不改 core/ 的 reducer/projector 语义（渲染层只消费，不重算）。
- 不改 contracts/ 与 migrations/。

## Notes

- 依赖已归档的 `store-transaction` 与 `reducer-projector`。
- 命令与语义以父任务 design.md 与 cli.md §4/§5/§7/§8 为权威。
