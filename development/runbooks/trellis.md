# 使用 Trellis 开发 Taskcraft

> 状态：Trellis `0.6.14` 已安装并完成 Codex/Claude 初始化；Bootstrap 已完成并归档，Task 00 正在进行最终仓库基线整理。

Trellis 是 Taskcraft 生产内核完成前的临时开发流程层。它管理开发任务的 PRD、design、implement、检查上下文和跨会话记录；Taskcraft 产品事实仍只来自根 `AGENTS.md`、`development/specs/`、`development/contracts/` 与 ADR。

## 1. 两套概念不要混用

| Trellis | Taskcraft |
| --- | --- |
| 管理“如何开发 Taskcraft” | 管理任意项目中的持久 Agent 任务 |
| task 状态为 planning/in_progress/completed | 公开状态为 queued/active/waiting/done/cancelled |
| PRD/design/implement 是开发产物 | lifecycle revision、attempt、review、evidence 是产品事实 |
| check 是开发质量检查 | Review 是独立节点、attempt 与 `reviewed_attempt_id` 合同 |
| Hook 注入 Trellis 当前任务 | 未来由 tc Adapter 注入 Taskcraft breadcrumb |

Trellis 活跃期间，不用 tc 同时维护同一开发任务。可以把已实现的 tc 当测试对象运行 fixture/smoke，但不能把同一任务状态写入两个系统。

## 2. 初始化前

必须满足：

1. 当前文档已形成可回退的 Git 基线，工作区中的其他改动归属清楚。
2. Node.js `>=18.17.0`、Python 3 可用；本机当前环境满足要求。
3. 用 `npm view @mindfoldhq/trellis version engines license` 重新确认版本、Node 要求和许可证。
4. 明确跟踪策略：自举期建议提交 Trellis 的项目文件，便于 Codex/Claude 共用同一任务与规范；运行时 session 文件遵守 Trellis 自带 `.gitignore`。
5. 先阅读 [`trellis-to-taskcraft.md`](trellis-to-taskcraft.md)，确认未来退出不依赖双写。

本文在 2026-08-07 验证的 Trellis 版本为 `0.6.14`，npm 包许可证为 `AGPL-3.0-only`。Trellis 只作为开发工具，不复制其实现代码到 tc；对外分发前仍需单独复核生成文件和许可证边界。

## 3. 安装与初始化

在仓库根目录执行：

```bash
npm install -g @mindfoldhq/trellis@latest
trellis init -u wangjie --codex --claude
```

不要添加未经确认的 `--template scratch`。`--template` 指远程 Spec 模板，不是“空项目模式”；当前默认初始化会生成通用 backend/frontend Spec 骨架和 `00-bootstrap-guidelines`，后续应按本项目事实精简。

初始化通常生成或修改：

```text
.trellis/               workflow、config、spec、tasks、workspace、scripts
.agents/skills/         Codex 等宿主读取的 Trellis skills
.codex/                 Codex agents、hooks 与项目配置
.claude/                Claude agents、commands、skills、hooks 与设置
AGENTS.md               仅加入 TRELLIS managed block
.gitattributes
```

初始化后立即审阅 `git status` 和 diff，重点确认根 `AGENTS.md` 的 Taskcraft 不变量仍在 Trellis managed block 之外。不要使用 `--force` 覆盖现有宿主配置。

## 4. 推荐配置与 Hook 验证

在 `.trellis/config.yaml` 显式加入：

```yaml
session_auto_commit: false

codex:
  dispatch_mode: inline
```

先关闭自动 journal/archive 提交，让项目提交仍由主 Agent 和用户审阅。Task 00 使用 Codex `inline`，由当前 Agent 直接完成合同和文档工作。Task 01 后若 Trellis implement/check 子 Agent 的上下文注入和写入边界 smoke 通过，再评审是否改回默认 `auto`。

Codex 用户配置需启用：

```toml
[features]
hooks = true
```

Codex 0.129+ 还需在 `/hooks` 审批项目 Hook。Claude Code 使用初始化生成的 SessionStart、UserPromptSubmit 和 sub-agent Hook。两个宿主都要验证：

- 无 active task 时只提示是否创建任务，不自动写入。
- planning 时注入规划门，不提前编辑代码。
- in_progress 时能恢复同一 task。
- Codex inline 模式不派生 implement/check Agent。
- Hook 失败可见，并可用项目内 `task.py current/list/validate` 诊断。

## 5. Bootstrap 只做索引

默认 `00-bootstrap-guidelines` 面向已有全栈代码，当前仓库尚无生产实现，不应凭空填写理想化 backend/frontend 规范。Bootstrap 应执行以下动作：

1. 把根 `AGENTS.md` 作为产品不变量和验证顺序入口。
2. 把 `development/specs/` 和 `development/contracts/` 登记为规范/合同来源，不复制正文。
3. 把 `development/plans/` 登记为阶段输入，把 `research/` 与 `prototypes/` 标为非规范。
4. 删除或明确标空不适用于当前代码的通用模板条目；代码约定只在真实工程模式出现后补充。
5. 完成并归档 bootstrap，确认后续 Agent 不会收到与 Taskcraft 冲突的通用约定。

## 6. 如何创建阶段任务

不要一次创建 Task 00–06。每个阶段通过后再创建下一阶段；阶段文档是需求来源，Trellis 任务保存本次执行材料。

在新会话中可直接说：

```text
请使用 Trellis 为 development/plans/task-00-contract-baseline.md 创建一个复杂任务并进入规划。
该文档是需求边界；先产出 prd.md、design.md 和 implement.md，不开始修改代码或合同。
完成后把范围、关键决策、子任务、验证命令和回滚点给我确认。
```

Trellis 要先获得“创建任务”的同意。创建任务不等于同意实现；复杂任务应具备：

- `prd.md`：目标、范围、非目标、验收，只引用阶段文档，不重写产品合同。
- `design.md`：边界、合同、数据流、取舍、兼容与回滚。
- `implement.md`：有序步骤、验证命令、Review gate 与依赖。
- `implement.jsonl` / `check.jsonl`：只列需稳定注入的 Spec/research，不预登记待改源码。

一个阶段含多个可独立验收交付物时使用父子任务。父任务负责来源需求、任务图和最终集成；子任务各自完成 plan/implement/check/archive。父子关系不是依赖图，先后顺序必须写在 PRD/implement 中。

## 7. 日常推进

规划批准后，Agent 才运行 `task.py start` 将任务置为 `in_progress`。正常流程：

```text
Plan → start → Implement → Check → Update Spec → Commit → Finish → Archive
```

Claude Code 可使用 `/trellis:continue` 和 `/trellis:finish-work`。Codex 不一定暴露 slash command，可说“继续当前 Trellis 任务”或使用生成的 `trellis-continue` / `trellis-finish-work` skill。诊断命令以仓库内脚本为准：

```bash
python3 ./.trellis/scripts/task.py current --source
python3 ./.trellis/scripts/task.py list --mine
python3 ./.trellis/scripts/task.py validate <task-dir>
python3 ./.trellis/scripts/task.py list-context <task-dir>
python3 ./.trellis/scripts/get_context.py --mode phase
```

不要手工修改 `task.json.status` 跳阶段。Trellis check 只证明本次开发质量，不替代 Taskcraft 产品中的独立 Review 证据。

## 8. 阶段完成标准

每个阶段归档前必须：

1. 按 `AGENTS.md` 的适用顺序运行测试、类型检查、构建和 smoke。
2. 把可复用产品决策写回唯一规范或 ADR；不要把 journal/research 当长期规则。
3. 审阅 diff 是否出现第二事实源、吞错 fallback、重复 reducer/validation、死代码或未说明行为变化。
4. 记录未运行检查与残余风险。
5. 提交代码后再 finish/archive，并更新 `development/plans/roadmap.md` 的实际阶段状态（开始实现后再增加状态字段）。

升级 Trellis 前先执行 `trellis update --dry-run` 并审阅生成文件变化。正式切换到 tc 时不要边升级边迁移。

## 9. 官方资料

- [安装与第一个任务](https://docs.trytrellis.app/start/install-and-first-task)
- [工作原理](https://docs.trytrellis.app/start/how-it-works)
- [日常使用](https://docs.trytrellis.app/start/everyday-use)
- [多平台支持](https://docs.trytrellis.app/advanced/multi-platform)
- [自定义 Hook](https://docs.trytrellis.app/advanced/custom-hooks)
- [Trellis GitHub](https://github.com/mindfold-ai/trellis)
