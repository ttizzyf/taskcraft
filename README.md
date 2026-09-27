# Taskcraft

Taskcraft 是面向 Codex 与 Claude Code 的 agent-first 任务协议、状态工具与可视化记录方案。SQLite Task Store 是唯一可写事实源，Agent 通过 CLI 推进任务，用户通过 Watch 查看任务、节点、证据和运行状态。

当前仓库包含 Taskcraft CLI、SQLite Store、Reducer/Projector、Codex/Claude Adapter、
Watch、产品规范和可执行合同。**自 2026-09-27 起本仓库用 Taskcraft 管理自己的开发
任务（狗粮化），Trellis 已完整卸载**；切换记录见
[.taskcraft/spec/history/trellis-cutover-2026-09-27.md](.taskcraft/spec/history/trellis-cutover-2026-09-27.md)。

## 入口

- **项目真相**：产品规格、实现合同与 ADR 在 `.taskcraft/spec/`，用 `tc spec list`
  查看目录（ADR 0011）；立项期历史档案在 `.taskcraft/spec/history/` 与 git 历史
  （标签 `trellis-final`）。
- [Evals 测评框架](evals/README.md)：delivery/recovery/review 三个 Agent 案例的 runner、grader 与运行说明（`pnpm eval`）。

## 工程开发

工程基础（Task 01）已就位：Node.js 24 + pnpm 10 + TypeScript 6 strict + Vitest 4 +
ESLint 10 + Prettier 3，全部命令基于 `pnpm`，版本由 `pnpm-lock.yaml` 固定。

### 全新 checkout

```bash
# 要求 Node >=24 <25，pnpm 10
pnpm install
```

### 常用命令

```bash
pnpm test          # Vitest 单元测试（前置构建）
pnpm typecheck     # tsc --noEmit
pnpm lint          # ESLint（max-lines 400 有效行）
pnpm format:check  # Prettier 检查
pnpm build         # 编译 src/ 到 dist/
pnpm check         # 汇总：test -> typecheck -> lint -> format:check -> build
```

### CLI smoke

```bash
node dist/cli.js --help
node dist/cli.js --version
```

### L1 CLI 纵切（Task 02）

`src/cli.ts` 注册 `init` / `task new|show|next|cancel` / `run`（含 `complete`
子命令）/ `status`。所有命令支持 `--json`；失败输出稳定 `TC_*` code 到 stderr
并以非零退出。真实 L1 闭环：

```bash
node dist/cli.js init
node dist/cli.js task new --title "Fix typo" --level 1 --reason "Local reversible text change" [--facts '{"domain":"docs"}']
node dist/cli.js run T-1 --node execute-1          # 输出 Node Brief（objective、Specs、obligations、result schema、登记命令）
node dist/cli.js run complete T-1 --result @result.json   # result 也可裸 JSON 或 @- 从 stdin
node dist/cli.js status --json                     # done + breadcrumb
```

`task new` 只建卡（queued）；`--facts` 为 JSON 对象（raw / @path / @-），
原样持久化到 `classification_facts_json`，非对象拒绝。`run` 是唯一激活入口
（同一事务写激活事实并创建首个 attempt）；`run complete` 同一事务满足
execute 与 record（result 的 `record` 段可让任务直达 done）。execute 结果
缺 `record` 段时任务保持 active，按 next 领取 `record-1` 节点补交：

```bash
node dist/cli.js run T-1 --node record-1           # 输出 record 节点 Node Brief
node dist/cli.js run complete T-1 --node record-1 --result '{"summary":"...","specImpact":{"outcome":"none","reason":"No reusable rule changed"}}'
```

`tc` 无参数时在恰有一个 active task 的场景提供无 task id 的快捷 next。
命令实现位于 `src/commands/`，text 与 JSON 渲染共用 projector/query model
输出，无第二套推导。

### 项目 Spec、Node Brief 与收口

`tc init` write-if-absent 创建 `.taskcraft/spec/index.json`。Registry 只登记 Git 中的
Markdown 路径；SQLite 保存任务实际采用的 id/path/digest，不复制正文：

```bash
node dist/cli.js spec check
node dist/cli.js spec list
node dist/cli.js spec resolve --path src/core/reducer.ts
node dist/cli.js task new --title "Change reducer" --level 2 --reason "Shared contract" \
  --specs '[{"id":"engineering.reducer","duty":"required"}]'
```

Execute 和 Review Node Brief 显示 exact Specs；required Spec 漂移会在创建 attempt 前
失败，recommended 漂移只提示。新 compiler 的 Record result 必须提交
`none|updated|candidate` Spec Impact：`updated` 需要 current Registry snapshot 与本
Task evidence，`candidate` 不会自动改写 Registry。`task show` 和 Watch 显示同一组
binding、drift 和 Impact；`tc doctor` 只读检查 Registry、provenance 与完整性。

### L2 Review CLI（含 review 回流）

`task new --level 2` 建卡后按 L2 图推进：frame → execute → review → record。
frame/execute/record 走 `run` / `run complete`，review 节点走 `tc review`
四命令；`task next` / `status` 的输出直接给出可执行的 review 命令：

```bash
node dist/cli.js task new --title "Add retry policy" --level 2 --reason "<judgment>"
node dist/cli.js run T-1 --node frame-1
node dist/cli.js run complete T-1 --node frame-1 --result frame.json
node dist/cli.js run T-1 --node execute-1
node dist/cli.js run complete T-1 --result result.json
node dist/cli.js review start T-1 --node review-1 --purpose delivery --reviewed-attempt <execute-attempt-id>
node dist/cli.js review pass T-1 --attempt <review-attempt-id> --reviewed-attempt <execute-attempt-id> --evidence <json|@path|@->
node dist/cli.js run T-1 --node record-1
node dist/cli.js run complete T-1 --node record-1 --result record.json
```

- `review start`：`--capability`（缺省 `context-only`）与 `--independence`
  （缺省 `unverified`）如实披露，`observed-distinct` 必须配 `host-observed`
  与 `--session-id`。
- `review pass`：`--evidence` 为 evidence gate（单条对象或数组均可）。
- `review changes`：写 blocking finding + successor execute attempt，同
  revision 内重做 execute 后再 review。
- `review replan --reason scope_changed|...`：写新 lifecycle revision，
  重走 frame/execute 后再 review；旧 revision 的 attempt/finding 历史在
  `task show` 中保持可查询（attempt 编号按节点全局递增，跨 revision 不冲突）。
- 完整可回放样本：`.taskcraft/spec/history/l2-review-sample.md`（三条路径 +
  失败契约三件套）。

### Task 02 可复用入口

- CLI：`src/cli.ts` 提供 Commander 15 的 `tc` 根入口；命令边界工具见
  `src/commands/helpers.ts`（`openTaskcraftDatabase` / `parseJsonInput` /
  `execute`）。
- 数据库：`openDatabase(filename)` 是 better-sqlite3 唯一入口，统一设置
  foreign keys、WAL、busy timeout 与 synchronous policy。
- Migration：`applyMigrations(database, directory)` 顺序执行 `migrations/*.sql`，
  维护 `schema_migrations` ledger，失败以 `TC_STORE_*` 错误码显式抛出。
- 合同：`src/contracts/schemas.ts` 提供 Ajv 2020 strict validator 与 JSON loader，
  覆盖 Lifecycle/Breadcrumb Schema 和 L2 任务 fixture。
