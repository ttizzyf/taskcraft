# Trellis → Taskcraft 切换记录（2026-09-27）

本文件是迁移手册 [`../runbooks/trellis-to-taskcraft.md`](../runbooks/trellis-to-taskcraft.md)
§3 要求的切换清单。它记录：切换时 Trellis 里有什么、每项做了什么处理、以及后续
建议的 tc 任务。此后 tc 是本仓库唯一的活动任务系统。

## 1. 切换决定与依据

- 决定：完整卸载 Trellis，Taskcraft 接管本仓库的开发任务管理。
- 依据：[`../migration-gate-audit-2026-09-27.md`](../migration-gate-audit-2026-09-27.md)。
  七条进入条件中 ②③④⑦ 证据充分，⑤⑥ 实物齐备。未走完的 ①（MVP 门与迁移门
  的先后）与 ⑤（合同冻结声明）属于流程决策，不是功能缺陷；负责人选择直接切换，
  相关决策以未来 tc 任务跟进（见 §5）。
- 审计点：git 标签 `trellis-final`（指向切换前最后一个 Trellis 管理的提交
  `f899fc8`）。`.trellis/`、平台 hook、skill 与 AGENTS.md managed block 的全部
  历史都在该标签中，可随时只读查阅。

## 2. Trellis 活跃任务的处理

切换时唯一活跃任务：`09-09-tc-evals`（Taskcraft 最小 Evals 框架与自动评分，
状态 `in_progress`，未归档）。

**处理决定：视为实质交付，不迁移为 tc 任务，后续收尾转为建议的 tc 任务。**

理由：框架已落地（`evals/` 目录、43 项专项测试、`pnpm eval --watch` 独立看板），
真实宿主测评已跑通（`evals/runs/` 16 份报告，2026-09-26 最新 delivery /
recovery / review 三份全 pass）。该任务的 PRD 与实现记录保留在
`trellis-final` 标签内的 `.trellis/tasks/09-09-tc-evals/`。

未完成范围（转为 §5 的后续任务建议）：

- review 案例仍为 L1，不覆盖 L2 回流协议；
- Pi SDK 宿主路径硬编码 macOS，Windows 本机只能用 claude 宿主；
- 任务本身的归档动作（随 Trellis 一并冻结，不再补归档）。

其余任务：2026-08 / 2026-09 归档任务与 workspace journal 全部已在 git 历史中，
不伪造为已完成的 tc 任务，也不迁移状态。

## 3. `.trellis/spec` 的处理

按迁移手册 §2 的映射逐项处理：

| 来源 | 处理 |
| --- | --- |
| `backend/spec-registry-contract.md` 等 6 份实现合同 | **搬移**到 `development/contracts/`（与既有 schema、storage.sql 同级），并登记进 `.taskcraft/spec/index.json`，正文仍是 Git Markdown |
| `backend/index.md`、`frontend/index.md` | 索引与 Pre-Development Checklist，指向 Trellis 会话流程，不搬移；其中"改什么要读哪份合同"的信息由 Spec Registry 的 `appliesTo` 承接 |
| `taskcraft.md` | 纯指针文件（把 Trellis 会话引向权威资料），不搬移 |
| `guides/*.md`（思维指南） | Trellis 自带的通用内容，与本项目无关，不搬移 |

六份合同的登记条目（id → 正文路径）：

| id | 正文 |
| --- | --- |
| `spec-registry-contract` | `development/contracts/spec-registry-contract.md` |
| `entry-hook-contract` | `development/contracts/entry-hook-contract.md` |
| `host-process-portability` | `development/contracts/host-process-portability.md` |
| `l3-modular-contract` | `development/contracts/l3-modular-contract.md` |
| `spec-lifecycle-contract` | `development/contracts/spec-lifecycle-contract.md` |
| `spec-delivery-contract` | `development/contracts/spec-delivery-contract.md` |

## 4. 卸载范围

以下内容全部为 Trellis 管理，切换时整体删除（历史见 `trellis-final` 标签）：

- `.trellis/`：workflow、config、scripts、剩余 spec、tasks、workspace
- `.claude/`：settings.json（Trellis Python hook 注册）、agents、commands/trellis、
  hooks、skills/trellis-*
- `.codex/`：config.toml、hooks.json、agents/trellis-*
- `.agents/skills/`：全部 trellis-* skill
- `AGENTS.md` 的 Trellis managed block

保留：AGENTS.md 的 Taskcraft Development Contract 正文、`development/` 全部
产品文档、产品代码与测试。README 与 development/README.md 中"Trellis 仍负责
当前开发任务"的表述同步更新。

删除 `trellis` CLI 已不在本机（`which trellis` 为空），手册 §4 的
`trellis uninstall` 以手工等价操作执行，删除范围与手册一致。

## 5. 后续建议的 tc 任务（切换时不创建，按需在全新会话建卡）

1. **首张 L1 dogfood 任务**：低风险、局部、可回滚，例如文档小改动；随后跑
   `tc agent test-entry-hook --agent claude` / `--agent codex` 取得切换后的注入
   证据（需要恰好一个 active task）。
2. **首张 L2 dogfood 任务**：覆盖一次独立 Review 的 pass 或 changes。
3. **合同冻结声明**（迁移门 ⑤）：写明冻结版本、变更流程与责任人，一句话决策
   落成 ADR 或 README 段落。
4. **L1 带 Spec 到 done 的单条闭环用例**（迁移门 ⑥ 小缺口）。
5. **evals 收尾**：review 案例补 L2 回流协议覆盖；Pi 宿主跨平台路径。
6. **MVP 门与迁移门先后的定义**（迁移门 ①）：决策类，写清即可解循环依赖。

## 6. 验收对照

对照手册 §6：

- tc 是唯一能改变活动开发任务状态的系统 ✅（Trellis 全部移除）
- 同一工作无 `.trellis/tasks` 与 Task Store 双份状态 ✅（旧任务只在 git 历史）
- 新会话只注入 Taskcraft breadcrumb ✅（宿主配置由 `tc init --agent` 重建）
- 每项长期规则只有一个权威位置 ✅（六份合同落 `development/contracts/`，
  Registry 只登记指针）
- 第一张 L1 / L2 dogfood 任务 ⏳（留给全新会话，见 §5）
