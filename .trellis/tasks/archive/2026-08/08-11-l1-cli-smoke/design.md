# Design: L1 CLI vertical slice

## Command Wiring

`src/cli.ts` 用 Commander 注册：
`init`、`task new|show|next|cancel`、`run`（含 `complete` 子命令）、`status`。

```text
tc init
tc task new --title <t> --level 1 --reason <r> [--facts <json|@path|@->]
tc task show <id> [--json]
tc task next <id> [--json]
tc task cancel <id> --reason <r>
tc run <id> [--node execute-1] [--host <host>] [--expected-revision <n>]
tc run complete <id> --result <path|json|@-|@path> [--expected-revision <n>]
tc status [--json]
tc                                        # 恰有一个 active task 时快捷 next
```

- 每个命令一个 `src/commands/<name>.ts`：解析参数 → 打开 DB
  （`openDatabase` + `applyMigrations`，`init` 前保证 `.taskcraft/` 存在）→
  调 reducer/projector → 渲染 → 退出码。
- DB 路径：`.taskcraft/taskcraft.db`（相对 cwd）；`tc init` 幂等创建目录 +
  DB + 迁移（migrations 目录路径与 repo 相对位置固定，从
  `import.meta.url` 解析 `../../migrations`，不依赖 cwd）。
- `run complete --result`：`@path` 读文件、`@-` 读 stdin、裸 JSON 直接解析；
  解析失败 → `TC_LIFECYCLE_RESULT_INVALID`（无法解析的 JSON）。
- `--json` 全局选项：输出 command result JSON（成功
  `{"schemaVersion":"tc-command-result/v1","ok":true,"data":{...}}`；
  失败同构 + errors 数组）；text 模式输出人类可读（同源数据）。
- 退出码：0 成功；1 业务/命令错误（TC_* 已渲染到 stderr）；2 内部异常
  （未预期错误，stderr 打印 code/message 与 cause）。

## Rendering

- text 渲染器（`src/commands/render.ts`）：status 行、node 列表
  （状态符号 + waitingReason）、required 完成度、next 命令；`task show`
  展示 objective/scope/acceptance/attempts/evidence 摘要。
- Node Brief（`run` 输出，纯数据版）：task id/level/revision、node id/kind、
  objective、required obligations（含已满足状态）、result schema 内联、
  登记命令（`tc run complete <id> --result <path>`）。
- breadcrumb：`status --json` 与 `task show --json` 的 data 内含
  `breadcrumb`（按 `breadcrumb.schema.json`，takeover 固定 "active"，
  next/detailCommand 从 projector 生成）；text 模式打印一行紧凑 breadcrumb。
- 同源原则：三种输出只从 `project(db, id)` 返回值取数据。

## Node Brief / result schema 展示

Node Brief 内联 result schema 时输出 JSON Schema 原文（execute schema 与
record 段），Agent 可直接按它构造 result；不做宿主渲染（Task 04）。

## Tests

- `tests/cli/` 集成测试：`execFileSync(process.execPath, [dist/cli.js, ...])`
  在临时目录 cwd 下运行。
  - init：首次创建 `.taskcraft/`；重复运行幂等成功；不覆盖已有 DB 内容
    （先写 meta 行再 init，验证仍在）。
  - task new：level 2/3 拒绝（退出码 1 + `TC_TASK_LEVEL_UNSUPPORTED`）；
    reason 缺失拒绝。
  - 完整闭环：init → new → run（Node Brief 含 result schema）→
    complete（`@path` 与 `@-` 各一次）→ status 显示 done；`task show --json`
    JSON 可解析且 text 字段一致。
  - cancel：queued 与 active 均可取消；重复取消报错。
  - CAS：`--expected-revision` 错值 → `TC_REVISION_CONFLICT` + 退出码 1。
  - 退出码契约：成功 0 / 业务错误 1。
- smoke 步骤在提交前于临时目录手动执行等价命令序列。

## Non-goals

- 不实现 `tc state --breadcrumb`（breadcrumb 数据在 status/show 中输出）；
  `tc state` 命令留后续任务。
- 不实现 review / wait / retry / evidence add。
