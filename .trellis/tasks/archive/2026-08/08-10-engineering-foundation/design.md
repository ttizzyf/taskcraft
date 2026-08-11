# Design: Taskcraft Engineering Foundation

## Structural Judgment

这是一个工程基础任务，但不需要父子任务。工具链、CLI 壳、migration 和合同测试
共享同一个 package、锁文件与最终 `check`，拆成多个 Trellis 子任务会增加提交和
集成成本。实现按小步骤推进，每一步都运行对应测试。

## Toolchain

- `package.json`：`private: true`、`type: module`、`bin.tc = dist/cli.js`、Node
  `>=24 <25`、`packageManager = pnpm@10.33.0`。
- TypeScript 固定 6.x。2026-08-10 的 TypeScript latest 是 7.0.2，但
  typescript-eslint 8.66.0 的 peer range 是 `<6.1.0`，因此使用兼容的 6.0.x。
- 运行依赖只包含 Commander 15、better-sqlite3 12 和 Ajv 8。
- 开发依赖只包含实际使用的 TypeScript、Node/SQLite 类型、ESLint 10、
  typescript-eslint 8、Prettier 3 和 Vitest 4。
- `tsconfig.json` 覆盖源码、测试和配置并用于 typecheck；`tsconfig.build.json`
  只编译 `src/` 到 `dist/`。使用 NodeNext ESM，不增加 bundler。

汇总命令顺序为：test -> typecheck -> lint -> format:check -> build。构建前使用
Node `fs.rmSync` 清理 `dist/`，不增加 rimraf 依赖。

## File Shape

```text
package.json
pnpm-lock.yaml
tsconfig.json
tsconfig.build.json
eslint.config.mjs
vitest.config.ts
src/
  cli.ts
  store/
    database.ts
    migrations.ts
  contracts/
    schemas.ts
migrations/
  0001_initial.sql
tests/
  cli.test.ts
  store/database.test.ts
  store/migrations.test.ts
  contracts/schemas.test.ts
  tooling/eslint-config.test.ts
  helpers/temp-directory.ts
```

文件只有在实现需要时创建；不增加 barrel、空目录、接口层或第二套配置来源。

## CLI Boundary

`src/cli.ts` 使用 Commander 的 ESM `Command`，名称为 `tc`，版本读取根
`package.json`，最后调用 `parseAsync()`。本任务只依赖 Commander 自带 help/version
行为。测试构建后的 `dist/cli.js`，避免为了测试创建第二个 CLI 抽象。

## SQLite Connection

`openDatabase(filename)` 是 better-sqlite3 的唯一创建入口，连接后显式设置：

- `foreign_keys = ON`
- `journal_mode = WAL`（内存库由 SQLite 返回实际支持的 mode）
- `busy_timeout = 5000`
- `synchronous = NORMAL`

Store 方法不做网络或模型调用。测试需要检查 WAL 时使用系统临时目录中的文件库，
其余合同测试可使用 `:memory:`。

## Migration Contract

`applyMigrations(db, directory)` 接收显式目录并按以下流程执行：

1. 创建 runner 自有的 `schema_migrations(version, name, checksum, applied_at)`。
2. 只接受 `NNNN_name.sql`；按数字 version 排序并拒绝重复。
3. 对 ledger 中的每项检查文件仍存在且 SHA-256 未变化。
4. 对每个未应用文件执行 `BEGIN IMMEDIATE`、SQL、ledger insert、`COMMIT`。
5. 任一步失败则 `ROLLBACK` 并重新抛出带 `TC_STORE_*` code 和原始 cause 的错误。

`0001_initial.sql` 从冻结的 `storage.sql` 复制 schema statements，但移除 connection
PRAGMA；PRAGMA 只属于 `openDatabase()`。一致性测试比较两边的 `sqlite_schema`，
排除 runner 自有的 `schema_migrations` 和 SQLite 内部对象。

不提供 migrate CLI、down、自动备份、ORM metadata 或 snapshot generator。

## Contract Validation

`src/contracts/schemas.ts` 只负责：

- 从 `development/contracts/` 读取 JSON。
- 创建 Ajv 2020 instance，启用 `strict: true` 和 `allErrors: true`。
- 编译 Lifecycle 和 Breadcrumb Schema，并向调用方返回 validator。
- 解析 fixture；没有对应 Schema 时只返回 JSON，不伪造校验通过。

解析、Schema 编译和实例校验错误保持可见，不用 broad catch 改写为成功。

## Quality Configuration

ESLint 使用 flat config 和官方 typescript-eslint 配置。`max-lines` 固定为：

```js
["error", { max: 400, skipBlankLines: true, skipComments: true }]
```

规则覆盖源码、测试和 JS/TS 工程配置；全局只忽略 `dist/`、`coverage/`、
`node_modules/` 和明确生成内容。`tests/tooling/eslint-config.test.ts` 使用 ESLint
Node API 对内存文本执行 400/401 行正负测试，不向仓库写巨型 fixture。

Prettier 只检查 `src/`、`tests/` 和根工程配置，不格式化 Trellis、研究、SQL 或
现有产品文档。

## Compatibility And Rollback

- 仓库没有生产包和数据，不需要旧工程兼容层。
- `storage.sql` 在 Task 01 后仍是审阅快照；migration 是可执行演进来源。
- 任一实现步骤失败时回退本任务提交即可；不修改 Task 00 已冻结的运行语义。
- better-sqlite3 是 native addon，最终必须在 Node 24 上完成真实安装和测试，不能
  只靠类型检查宣称兼容。
