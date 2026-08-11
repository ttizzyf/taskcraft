# Build Taskcraft Engineering Foundation

## Goal

建立可重复安装、检查、测试、构建和迁移的最小 Node/TypeScript 工程，使 Task 02
可以直接实现 Store、reducer 和 CLI 业务闭环，不再重新解决工具链与合同加载问题。

## Background

- 来源需求是 `development/plans/task-01-engineering-foundation.md`。
- Task 00 已完成并归档；当前 SQL、JSON Schema、ADR 和模块边界已经冻结。
- 仓库当前没有 `package.json`、生产 `src/`、`tests/`、migration 或锁文件。
- 当前工作区中的 Task 01 计划修改属于本任务：Commander.js 15、ESLint 10、
  typescript-eslint 8、Prettier 3 和 400 行文件上限。
- 本任务是工程基础，不实现 Taskcraft 的任务状态、命令业务、Adapter 或 Watch。

## Requirements

### REQ-01. Reproducible Toolchain

建立单 package、private、ESM 工程。使用 Node.js 24、pnpm 10、TypeScript 6 strict、
Vitest 4、ESLint 10、typescript-eslint 8 和 Prettier 3；patch 版本由
`pnpm-lock.yaml` 固定。使用 `tsc` 构建，不增加 bundler、workspace、ORM 或 DI
framework。

### REQ-02. Minimal CLI Shell

使用 Commander.js 15 建立 `tc` 入口，只实现根帮助和版本输出。CLI 可以构建并从
`dist/` 运行，但不得提前增加 `task`、`run`、`review`、migration 或 Adapter 命令。

### REQ-03. SQLite Connection And Migration

集中设置 foreign keys、WAL、busy timeout 和 synchronous policy。实现顺序 SQL
migration runner、`schema_migrations` ledger 和 `0001_initial.sql`：拒绝非法名称、
重复版本、缺失的已应用文件和 checksum 漂移；每个 migration 在独立
`BEGIN IMMEDIATE` 事务中执行，失败不写 ledger row，也不留下该 migration 的
部分结构。不实现 down migration、自动备份、插件或 snapshot 生成器。

### REQ-04. Contract Validation

使用 Ajv 8 Draft 2020-12 strict 编译 Lifecycle 与 Breadcrumb Schema。只对有对应
Schema 的实例做校验；`l2-task.fixture.json` 只做 JSON 解析，不拿错误的 Schema
硬套。合同加载必须使用明确路径并保留解析或校验错误。

### REQ-05. Test Isolation

SQLite 和 migration 测试使用系统临时目录或内存数据库，测试完成后清理，不写
仓库固定数据库，不依赖用户目录、网络、宿主凭据或当前 shell 状态。Vitest 单元
测试与 hook 的硬超时为 60 秒。

### REQ-06. Quality Gates

提供 `format:check`、`lint`、`typecheck`、`test`、`build` 和汇总 `check`。
ESLint 内置 `max-lines` 对普通源码、测试和工程配置统一执行 400 个有效行上限，
空行和纯注释不计；只排除 `dist/`、`coverage/` 和明确的生成文件。使用真实正负
用例验证 400 行通过、401 行失败，不创建自定义 lint 插件或第二套行数检查器。

### REQ-07. Developer Handoff

文档列出全新 checkout 的安装、检查、测试、构建命令，以及 Task 02 可以直接复用
的 CLI、数据库、migration 和 Schema 校验入口。

## Acceptance Criteria

- [ ] `pnpm install --frozen-lockfile` 在锁文件存在时可重复安装，Node/pnpm 版本边界明确。
- [ ] `tc --help` 和 `tc --version` 的构建后 smoke 通过，且没有真实业务子命令。
- [ ] 空数据库可应用 `0001_initial.sql`；重复运行不重复写入，结构与
  `development/contracts/storage.sql` 一致，`foreign_key_check` 为空。
- [ ] duplicate version、missing applied file、checksum drift 和 migration 中途失败
  都显式失败；失败 migration 没有 ledger row 或部分结构。
- [ ] 两份 JSON Schema 在 Ajv strict 下编译，代表性正负实例按预期通过或失败，
  现有 JSON fixture 均可解析。
- [ ] 数据库和 lint 正负测试不向仓库写临时产物。
- [ ] 400 个有效行通过 lint，401 个有效行以 `max-lines` 失败；源码与测试不豁免。
- [ ] `pnpm check` 和构建后 CLI smoke 全部通过。
- [ ] 没有 `domain/`、`command/`、`adapters/`、`watch/` 空壳，没有 reducer、
  projector、真实 CLI 命令、Hook 或 Web 代码。

## Out Of Scope

- Taskcraft 的 task/reducer/projector/Review 业务行为。
- Codex、Claude、Hook、subagent、Watch 或网络服务。
- 远程 CI 配置、发布流程、shell completion 和安装器。
- 多 package、ORM、通用 repository/driver interface、down migration 和代码生成。
