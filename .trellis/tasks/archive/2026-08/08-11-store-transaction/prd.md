# Store and transaction layer

## Goal

在 Task 01 的 `openDatabase` / `applyMigrations` 之上提供事务封装、revision/CAS
守卫与只读 query model，为 reducer 与 CLI 提供唯一的数据访问边界。

## Requirements

### REQ-01. Transaction Wrapper

`withTransaction(db, fn)`：`BEGIN IMMEDIATE` 开始，fn 抛错时 `ROLLBACK` 并
把错误包裹为 `TC_STORE_TRANSACTION_FAILED`（保留 cause），成功 `COMMIT`。
调用方不需要手动管理 begin/commit/rollback；嵌套调用显式报错（better-sqlite3
已禁止嵌套事务，错误要明确）。

### REQ-02. Revision CAS Guard

`checkRevision(db, taskId, expectedRevision)`：读取 `tasks.revision`，不匹配抛
`TC_REVISION_CONFLICT`（响应含当前 revision 与重读命令），匹配时返回供
reducer 使用的任务快照。`expectedRevision` 缺省语义由上层命令决定，守卫本身
不猜测。

### REQ-03. Read-only Query Model

`query.ts` 提供 projector/CLI 需要的只读查询：task 行（含 facts 字段）、
lifecycle revision + nodes/edges/obligations、node_attempts、evidence、
obligation_results、open blockers、events 最近 seq。只暴露读接口，不暴露写
入口；与 `withTransaction` 组合时在同一事务内读取。

### REQ-04. Tests

事务回滚（构造中途失败验证无部分事实/孤立 attempt）、成功提交边界、
CAS 冲突（稳定错误 + 当前 revision）、query model 只读（类型层面无写方法）、
与 `applyMigrations` 组合的 smoke。

## Acceptance Criteria

- [ ] 失败事务回滚后数据库状态与事务前完全一致（无部分事实、无孤立行）。
- [ ] `TC_STORE_TRANSACTION_FAILED` 包裹原始 cause，message 可诊断。
- [ ] CAS 冲突返回 `TC_REVISION_CONFLICT` 与最新重读命令，不写任何事实。
- [ ] query model 只读：无写方法，返回纯数据快照。
- [ ] 新增文件有效行 ≤ 400；`pnpm check` 全绿。

## Non-goals

- 不改 `database.ts` / `migrations.ts` / `0001_initial.sql`。
- 不实现业务命令、reducer、projector 或 CLI 子命令。
- 不引入 ORM 或 repository interface 抽象。

## Notes

- 依赖父任务 design.md 的 Module Shape 与 Error Taxonomy。
- 实现顺序：`store-transaction` → `reducer-projector` → `l1-cli-smoke`
  （写在本子任务 implement.md）。
