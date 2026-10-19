# ADR 0012：不对文件字节做哈希

- 状态：已接受
- 日期：2026-10-19
- 范围：Migration ledger、Spec binding、Spec Impact
- 取代：[0006](0006-migrations-and-contract-validation.md) 中关于 `schema_migrations.checksum` 的决定

## Context

Taskcraft 曾把三处「文件原始字节的 SHA-256」当作事实存下来，并在之后拿它回校验：

1. `schema_migrations.checksum`：每次打开 Store 都重算磁盘上迁移 `.sql` 的哈希并比对，
   不符即 `TC_STORE_MIGRATION_CHECKSUM_MISMATCH`。
2. `lifecycle_spec_bindings.spec_digest`：绑定快照记录 Spec 正文哈希，据此派生「漂移」
   概念，并让 required 漂移硬门禁住新的 Execute attempt。
3. `spec_impact_results` 的 `updates[].digest`：Record 时由调用方手填正文哈希。

三处的目的都是「检测已记录的文件后来被改过」。但实现把**内容一致性**绑死在**文件的
行尾表示**上：仓库内是 LF，Windows 检出是 CRLF，同一份文件两个哈希。`.taskcraft/
taskcraft.db` 又是提交进 git 的，于是「绑定 Windows 检出形态」的账本跟着仓库走到
任何一台机器——在 LF 检出上，`tc` 打开库即失败，整个 CLI 不可用，且没有任何 CLI
补救路径。Spec 侧则以另一种形式发作：每次编辑被绑定的文档，都让所有历史任务永久
飘红且无 remedy。

实测（2026-10-19）：`migrations/0001`–`0003` 在仓库里是纯 LF，工作区是纯 CRLF；
账本记的 `2f91bc54…` 正是 CRLF 那一版，按 LF 算是 `b35dde12…`。

## Decision Drivers

- 哈希必须跨平台稳定，不能因检出方式而异。
- 历史事实不得用当下现状校验。
- 不建立当前用不到的证据框架。

## Options

1. 保留哈希，计算前归一化行尾。保证跨平台一致，但仍在维护一套「内容指纹」。
2. 保留哈希，改为比结构（`sqlite_master` 规范快照）而非文件字节。更强，但仍是同一
   类校验。
3. 移除全部字节哈希：账本只记版本与文件名，绑定只记采用了哪些文档，Impact 只记
   id/path/evidence。

## Decision

采用选项 3。

- `schema_migrations` 只保存 `version`、`name`、`applied_at`。runner 仍拒绝重复版本，
  并拒绝「已应用的版本在磁盘上没有对应文件」——那是真实的、有补救路径的损坏。
- `lifecycle_spec_bindings` 只保存 `spec_id / spec_kind / spec_path / duty` 与来源
  provenance。**漂移概念整块删除**：绑定是历史事实，不是对当下文件的断言。
- Spec Impact 的 `updated` 只保存 `specId`、`path`、`evidenceRefs`。
- Registry 解析只证明正文存在且可读（containment、regular file、可读性、读取稳定），
  不再计算摘要。
- 已有库通过 `0005_drop_byte_digests.sql` 收敛：重建账本表、删除 `spec_digest` 列，
  并从既有 Impact 的 JSON 中移除 `digest`。

**代价（明确接受）**：编辑一条已经应用过的迁移不再被检测。这个错误在 `git diff` 里
一眼可见，而它原来的代价是「换平台整个工具不可用」。

## Consequences

- 行尾策略不再被任何哈希约束；`.gitattributes` 可以自由选择。
- `tc doctor` 把 Registry 与 Store 分开检查：Registry 是否可加载、是否合法单独报告，
  不与任何 Store 事实比对。
- 需要重新绑定当前 Registry 时，用显式命令 `tc task spec refresh`。
- 证据引用上的可选 `digest` 字段不在本决定范围内（它与文件字节无关）。
- `lifecycle_revisions.facts_digest` / `policy_digest` 同样不在范围内：它们是
  compiler 输入的摘要，不绑行尾。

## Exit Cost

低。三处都是「删除一个校验」，不引入新机制。若将来需要「库与迁移是否一致」的保证，
正确的做法是比较 schema 形状（`sqlite_master` 规范快照），而不是文件字节。

## Contract Mapping

- `engineering/spec-lifecycle-contract.md`：binding 快照与 refresh。
- `engineering/spec-delivery-contract.md`：Node Brief、delivery DTO、doctor 检查。
- `engineering/spec-registry-contract.md`：Registry 解析不再计算摘要。
- `product/architecture.md`、`product/cli.md`、`product/lifecycle.md`。
- SQL：`migrations/0005_drop_byte_digests.sql`、`src/contracts/storage.sql`。

## Evidence

- 实测哈希：`migrations/0001`–`0003` 仓库内 LF、工作区 CRLF，两版 SHA-256 不同。
- `tc doctor` 在 LF 检出上因 `TC_STORE_MIGRATION_CHECKSUM_MISMATCH` 无法打开 Store。
