# 任务 01：工程基础与合同测试框架

## 目标

建立可重复安装、构建、测试和迁移的最小工程骨架，使后续任务只关注业务合同，不重复解决工具链问题。

## 依赖

- 任务 00 完成。
- 技术栈、迁移策略和模块边界已经由 ADR 冻结。

## 必读输入

- `AGENTS.md`
- `development/decisions/0005-implementation-language-and-toolchain.md`
- `development/decisions/0006-migrations-and-contract-validation.md`
- `development/decisions/0008-document-authority-and-module-boundaries.md`
- `development/contracts/storage.sql`
- `development/contracts/lifecycle.schema.json`
- `development/contracts/breadcrumb.schema.json`
- `development/contracts/fixtures/`
- `development/specs/architecture.md`

## 固定技术选择

- Node.js 24，`package.json` 声明支持的主版本。
- pnpm 10，提交 `pnpm-lock.yaml`，可用 frozen lockfile 安装。
- TypeScript 6 strict，不引入运行时 decorator 或另一套 DTO class。
- `better-sqlite3` 12，只由 Store 边界直接使用。
- Ajv 8，Draft 2020-12 strict；当前不安装 `ajv-formats`。
- Commander.js 15 作为 CLI 框架；Task 01 只装配根命令、`--version` 和 `--help`。
- ESLint 10 与 typescript-eslint 8 校验 TypeScript/JavaScript，并启用内置
  `max-lines`：每个文件最多 400 行，空行和纯注释不计入。
- Prettier 3 提供 `format:check`，只覆盖 Taskcraft 源码、测试和工程配置。
- Vitest 4；后端单元测试硬超时为 60 秒。

具体 patch 版本由锁文件固定。Task 01 不再重新选择语言、包管理器、SQLite
driver、Schema 校验器、CLI 框架、lint 工具或测试框架。

## 范围

1. 建立包管理、编译、格式化、静态检查和测试入口。
2. 只建立空 CLI、SQLite/migration、JSON Schema 校验和合同测试实际需要的目录。
3. 把 SQL 草案转成可版本化 migration，并提供内存数据库测试工具。
4. 建立 JSON Schema 校验与 fixture 加载工具。
5. 定义稳定的测试超时和临时目录策略。
6. 提供 `format:check`、`lint`、`typecheck`、`test`、`build` 和汇总 `check` 命令，
   但不要求本任务配置远程 CI。

## 最小文件与依赖方向

允许的最小形态如下，Task 01 可按所选工具调整文件名，但不能扩大职责：

```text
package.json
pnpm-lock.yaml
tsconfig.json
eslint.config.*
src/
  cli.ts                    # Commander 根命令，只输出版本和帮助
  store/                    # SQLite connection 与 migration runner
  contracts/                # Ajv 编译和 fixture 加载
migrations/
  0001_initial.sql
tests/
  contracts/                # SQL、migration、JSON Schema 合同测试
  helpers/                  # 临时数据库和 fixture helper
```

依赖保持单向：CLI 可以调用基础工具；migration 只依赖 Store connection；合同
校验只读取 `development/contracts/`；测试可以调用 `src/` 和合同资产。Task 01
不创建 `domain/`、`command/`、`adapters/`、`watch/` 空壳，也不创建未来 driver、
模型 SDK 或多 package 的 interface。Command service、reducer 和 projector 从
Task 02 的真实闭环开始实现。

## 交付物

- 可安装的工程配置和锁文件。
- 空 CLI 入口或等价程序入口，能输出版本和帮助。
- migration runner 与第一版 schema migration。
- contract test harness、fixture helper 和 SQLite test helper。
- `format:check`、`lint`、`typecheck`、`test`、`build`、`check` 命令及简短说明。

## 验收标准

- 全新 checkout 可以通过一组明确命令完成安装、检查、测试和构建。
- migration 可在空数据库应用，重复应用有确定行为，失败不留下部分状态。
- migration 按零填充版本顺序执行，拒绝重复版本和 checksum 漂移；每个 migration
  在独立 `BEGIN IMMEDIATE` 事务中应用。
- migration 后的结构与 `development/contracts/storage.sql` 一致，
  `foreign_key_check` 为空。
- 当前 JSON Schema 能以 Ajv Draft 2020-12 strict 编译；有对应 Schema 的实例
  必须通过校验，其余 fixture 至少通过 JSON 解析。不得用错误的 Schema 校验
  不同类型的 fixture。
- 测试不会写入仓库固定路径或依赖用户机器状态。
- `pnpm lint` 对超过 400 个有效行的 TypeScript/JavaScript 文件返回失败；
  `dist/`、`coverage/` 和生成文件不参与检查，普通源码和测试不豁免。
- 不存在吞掉异常或假装成功的 fallback。

## 非目标

- 不实现任务状态推导。
- 不实现任何真实 Taskcraft 命令。
- 不接入 Codex、Claude 或 Web UI。

## 验证

1. `pnpm install --frozen-lockfile`
2. `pnpm test`，单元测试硬超时 60 秒。
3. `pnpm typecheck`、`pnpm lint` 和 `pnpm format:check`。
4. `pnpm build`。
5. 空数据库 migration、重复运行、checksum drift、失败回滚和
   `foreign_key_check` smoke。
6. 在临时目录分别用 400 行以内和超过 400 个有效行的 TypeScript 文件验证
   ESLint 通过与失败；临时文件不写入仓库。

## 后续启动提示

任务标题：`Build Taskcraft engineering foundation`

请以工程 ADR、SQL 和 Schema 为实现输入，并遵守本文的验证顺序与 migration 失败要求。完成结果必须列出后续任务可直接调用的命令。
