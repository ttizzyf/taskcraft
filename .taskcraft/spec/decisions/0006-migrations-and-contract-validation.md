# ADR 0006：Migration 与合同验证

- 状态：已被 [0012](0012-no-byte-digests.md) 部分取代（checksum 部分）
- 日期：2026-08-10
- 范围：Task 00

## Context

当前 `storage.sql` 是设计期完整快照，但 Task 01 需要可重复升级的 migration。
若快照和 migration 都可手工修改，会形成两个事实源。

## Decision Drivers

- migration 必须按顺序执行，失败时原子回滚。
- 已应用 migration 不可静默修改。
- SQL 与 JSON Schema 都要有结构化验证。
- 不建立当前用不到的回滚框架。

## Options

1. 每次启动重放完整 `storage.sql`。简单，但不能安全演进。
2. 顺序执行 immutable SQL migration，并验证 schema snapshot。
3. 使用 ORM migration。引入额外模型层，可能偏离 SQL 合同。

## Decision

采用选项 2：

- Task 01 把冻结后的 `storage.sql` 作为 `0001_initial.sql` 的输入。
- migration 文件按零填充版本顺序执行，已发布文件只增不改。
- `schema_migrations` 只保存 version、name、checksum 和 applied_at。checksum 防止
  已应用文件被静默改写；不保存 runner version。（**checksum 已被 0012 移除**：它绑死
  了工作区的行尾表示。其余决定仍然有效。）
- runner 按版本应用尚未执行的文件，并拒绝重复版本和 checksum 漂移。（后半句已被
  0012 取代：现在只拒绝「已应用版本在磁盘上没有对应文件」。）
- 每个 migration 在独立 `BEGIN IMMEDIATE` 事务中执行；失败保留原错误并回滚，
  不更新 `schema_migrations`。
- WAL、busy timeout、foreign keys 和 synchronous 是 connection policy，不藏在
  migration 的偶然副作用里。
- 不提供自动 down migration。需要回退时先停止写入，恢复已验证备份，或追加
  forward-fix migration。
- Task 01 起 migration 是可执行演进事实源；`storage.sql` 只作为合同审阅快照，
  测试通过空库重放确认两者一致，不增加生成器。
- JSON Schema 用 Ajv Draft 2020-12 strict 编译；SQL 用空库全量重放、升级 fixture、
  `foreign_key_check` 和约束负例验证。

## Consequences

- 每次 Schema 改动需要 migration、审阅快照和测试一起更新。
- 没有方便但危险的 down 命令。
- SQLite pragma policy 由 Store connection 集中管理。

## Exit Cost

低到中。SQL 文件和 migration ledger 没有绑定 ORM。换 runner 时保留顺序、
事务语义与「已应用版本在磁盘上有对应文件」的校验即可。

## Contract Mapping

- SQL：Task 00 冻结 snapshot；Task 01 创建等价 initial migration。
- architecture：定义 migration authority 和 connection policy。
- CLI：migration failure 使用稳定 `TC_STORE_*` 错误并显示 remediation。

## Task 01 Input

实现最小 migration runner 和 `schema_migrations`。首批测试只覆盖空库、重复
运行、checksum drift、失败回滚和 foreign key check（checksum 用例已由 0012 移除），
不实现 down migration、
自动备份、迁移插件或 snapshot 生成器。

## Evidence

- `development/contracts/storage.sql`
- DB-01 在 SQLite `3.50.6` 内存库的正负约束结果。
- [SQLite transactions](https://www.sqlite.org/lang_transaction.html)
- [SQLite WAL](https://www.sqlite.org/wal.html)
