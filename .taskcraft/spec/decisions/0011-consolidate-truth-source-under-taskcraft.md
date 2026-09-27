# 0011：真相源收拢到 `.taskcraft/spec/`

日期：2026-09-27 ｜ 状态：已接受

## 决定

产品的权威行为规格、跨层实现合同和架构决策（ADR）的**正文**全部迁入
`.taskcraft/spec/`，由 Taskcraft 的 Spec Registry 统一登记：

```text
.taskcraft/spec/
  index.json        ← tc-spec-registry/v1，真相的唯一目录
  product/          ← 权威产品规格（原 development/specs/）
  engineering/      ← 跨层实现合同（原 .trellis/spec/backend/，经 development/contracts/ 中转）
  decisions/        ← ADR（原 development/decisions/）
```

Trellis 立项期建立的 `development/` 文档树不再是真相源的存放地。

## 背景

`development/` 是立项期（Task 00–07）建立的方案与文档目录。立项内容交付后，
它同时承载了三类性质不同的东西：活真相（规格/合同/ADR）、产品运行时机器合同
（schema/SQL/fixtures）、历史档案（plans/handoffs/运行记录）。"项目真相"与
"立项档案"混在一处，Agent 开任务时没有单一入口；Spec Registry 建立后，
真相正文继续留在 development/ 会让 tc 的目录体系名不副实。

## 后果

- 正文仍是 Git Markdown，`.taskcraft/` 除 cache 与 db 临时文件外全部入库；
  tc 只管理"目录（Registry）、绑定（binding）、漂移（digest）与收口（Impact）"，
  不把真相锁进数据库——单一事实源原则不变。
- Registry 同步登记 `product/` 四份规格（domain，authority 为 AGENTS.md
  开发合同）与 `engineering/` 六份合同（engineering）。
- ~~`development/contracts/` 中的 schema/storage.sql/fixtures 保留原地~~
  **已迁移**（同日跟进）：机器合同现居 `src/contracts/`（schema/storage.sql/fixtures），
  `src/contracts/schemas.ts`、`tests/helpers/load-fixture.ts`、
  `tests/store/migrations.test.ts` 同步改读新路径。
- `development/` 已整体移除：近期决策与可复用样本（cutover 记录、迁移门审计、
  l2-review-sample、l3-sample）迁入 `.taskcraft/spec/history/`，其余历史档案
  只存于 git 历史（`trellis-final` 等标签保留全部可审计状态）。
- 自动把"任务适用的规范"送到 Agent 面前（开工自动发现）是独立的后续行为变更，
  见讨论记录；本 ADR 只决定"真相存放在哪、目录由谁管理"。

## 替代方案

- **真相正文搬进 SQLite**：否决——违反"Registry 与正文留在 Git"的架构事实，
  数据库不该承载长文档的编辑与评审流程。
- **保持 development/ 不动，Registry 指过去**：否决——立项目录与活动真相混放，
  "tc 是唯一任务系统"的语义不完整，目录心智模型分裂。
