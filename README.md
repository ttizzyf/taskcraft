# Taskcraft

Taskcraft 是面向 Codex 与 Claude Code 的 agent-first 任务协议、状态工具与可视化记录方案。SQLite Task Store 是唯一可写事实源，Agent 通过 CLI 推进任务，用户通过 Watch 查看任务、节点、证据和运行状态。

当前仓库处于开发准备阶段，包含产品规范、可执行合同、架构决策、开发任务和交互原型，尚未包含生产实现。Trellis `0.6.14` 已初始化；Bootstrap、Task 00 和 Task 01 已完成并归档。Taskcraft MVP 验收后将退出 Trellis 并开始狗粮化。

## 入口

- [开发指南](development/README.md)：规范、合同、Task 00–06、Trellis 工作流与迁移方案的唯一入口。
- [交互原型](development/prototypes/watch.html)：当前 Watch 交互概念的静态演示。

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
node dist/cli.js run T-1 --node execute-1          # 输出 Node Brief（objective、obligations、result schema、登记命令）
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
node dist/cli.js run complete T-1 --node record-1 --result '{"summary":"..."}'
```

`tc` 无参数时在恰有一个 active task 的场景提供无 task id 的快捷 next。
命令实现位于 `src/commands/`，text 与 JSON 渲染共用 projector/query model
输出，无第二套推导。

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
