# ADR 0005：实现语言与工具链

- 状态：已接受
- 日期：2026-08-10
- 范围：Task 00

## Context

Task 01 需要在没有生产代码的仓库中建立最小工程骨架。CLI、SQLite、JSON
Schema、Adapter 和未来 Watch 需要共享类型，但当前没有冻结语言和测试工具。

## Decision Drivers

- CLI 和未来桌面/Web 投影共享类型。
- 单一 command service 的写事务要简单、可测试。
- JSON Schema 必须在 Taskcraft 写入边界严格校验。
- 依赖版本必须由 lockfile 可重复安装。
- 不为将来可能替换的库预建接口。

## Options

1. TypeScript + Node.js。与 JSON、CLI、未来 Watch 共享类型方便。
2. Rust。二进制和 SQLite 控制强，但首版 UI/Adapter 类型共享成本较高。
3. Python。原型快，但分发、类型合同和前端共享较弱。

## Decision

采用 TypeScript：

- runtime：Node.js 24；`package.json` 声明受支持的 Node 主版本。
- package manager：pnpm 10，提交 `pnpm-lock.yaml`，CI 使用 frozen lockfile。
- TypeScript 开启 strict，不用运行时 decorator 或第二套 DTO class。
- SQLite driver：`better-sqlite3` 12。同步事务与单写 command service 匹配；
  启动时显式设置 foreign keys、WAL、busy timeout 和 synchronous policy。
- JSON Schema：Ajv 8，使用 Draft 2020-12 和 strict 模式。当前 Schema 没有
  `format`，所以不安装 `ajv-formats`。
- 测试：Vitest 4，后端单元测试硬超时 60 秒。
- 具体版本由 `pnpm-lock.yaml` 冻结，ADR 不重复维护 patch version。

## Consequences

- `better-sqlite3` 有 native addon，安装与 Node ABI 需要 CI 验证。
- 同步 DB API 不能在长事务里做网络或模型调用；command service 事务必须短。
- TypeScript 类型不代替 runtime Schema 校验。

## Exit Cost

- pnpm、Ajv、Vitest：低到中。
- `better-sqlite3`：中；当前直接放在 store 模块中，不为假设中的第二个 driver
  预建 port 或 repository interface。
- TypeScript/Node：高，因此 domain 不直接依赖 CLI 框架或 SQLite API。

## Contract Mapping

- architecture：补充 runtime/toolchain 和同步短事务约束。
- Task 01：建立 package、tsconfig、lint/typecheck/test scripts。
- contracts：Schema 通过 Ajv Draft 2020-12 编译测试。

## Task 01 Input

只安装 Task 01 实际使用的 TypeScript、better-sqlite3、Ajv 和 Vitest 相关依赖；
先写 storage/Schema smoke 和 migration rollback 测试。不得提前引入 ORM、DI
framework、Adapter SDK、Web server 或未来 driver 接口。

## Evidence

- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3)
- [Ajv JSON Schema](https://ajv.js.org/json-schema.html#draft-2020-12)
- [Vitest config](https://vitest.dev/config/)
- 本机：Node `24.8.0`、pnpm `10.33.0`、SQLite `3.50.6`。
