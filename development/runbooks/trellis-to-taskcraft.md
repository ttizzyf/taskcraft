# 从 Trellis 迁移到 Taskcraft 狗粮化

> 状态：计划中的切换手册。默认在 Task 00–06 全部完成并通过 MVP 验收后执行；当前尚无 Trellis 文件需要移除。

目标是在一个明确切换窗口内停止 Trellis 的任务状态、Hook 和上下文注入，让 tc 成为后续开发的唯一活动任务系统。退出保留可审计历史，但不把 Trellis 状态机械翻译成 Taskcraft 五状态，也不设置双写期。

## 1. 进入条件

默认进入条件：

- Task 00–06 的验收已完成，MVP 发布门通过。
- Store migration、事务、CAS、单 reducer/projector 和 `tc doctor` 通过。
- L1 与 L2 在至少一个真实宿主完成创建、恢复、waiting/resume、Review 和 done 样本。
- Codex 与 Claude Adapter 已声明真实 capability；Hook 不可用时可用 `tc task next` 恢复。
- Node Brief、Command Result、evidence 和 breadcrumb 合同已冻结。
- Watch 是否可用不影响 CLI 恢复，但默认路线要求 Task 06 已完成后再切换。

如果 tc 只能完成 demo、不能从新会话恢复活动任务，就不满足狗粮化条件。

## 2. 迁移映射

| Trellis 内容 | 迁移处理 |
| --- | --- |
| active/planning PRD | 切换后人工创建新的 tc task，保存来源路径和未完成范围 |
| design/implement | 长期决策进入 ADR；短期步骤仅作为来源/evidence reference |
| `.trellis/spec` | 与 AGENTS/`development/` 比较，只合并当前有效且不重复的规则 |
| research | 仅迁移仍有效、可分类且有来源的 fact/evidence |
| 未完成 checklist | 转为 tc acceptance、required obligation 或独立后续任务 |
| completed/archive/journal | 保留在 Git tag/归档中，不伪造为已完成 tc task |
| task status/session pointer/Hook | 不迁移，冻结后移除 |

## 3. 最后一张 Trellis 任务

创建最后一张 Trellis 任务 `Cut over from Trellis to Taskcraft dogfood`，它只负责准备和关闭旧系统：

1. 宣布切换窗口，停止创建其他 Trellis 任务并固定 Trellis 版本。
2. 盘点所有 planning/in_progress/completed/archive task，逐项决定完成、取消、迁移或只读归档。
3. 生成 `development/migrations/trellis-cutover-YYYY-MM-DD.md`，记录来源任务、未完成范围、处理决定和未来 tc task 建议；此时不要提前创建 tc task。
4. 对比 `.trellis/spec` 与权威文档，把长期规则合并到唯一位置。
5. 运行项目完整验证并保存最后的 Trellis task 清单、版本和 commit。
6. finish/archive 最后一张任务，关闭所有 Trellis 会话。

最后一个 Trellis commit/tag 是只读审计点。历史可以通过 Git 查看，不应继续放在活动 Hook 路径中。

## 4. 卸载 Trellis

先在干净工作区预览：

```bash
trellis uninstall --dry-run
```

逐项确认将移除 `.trellis/`、Trellis 管理的平台 skills/agents/commands/hooks，以及根 `AGENTS.md` 中的 Trellis managed block；Taskcraft 自有的 AGENTS 内容、非 Trellis 宿主配置和产品代码必须保留。确认后执行：

```bash
trellis uninstall
```

随后检查：

- 仓库中不存在仍指向 `.trellis/` 的 Hook、skill、command、agent 或配置。
- Codex/Claude 新会话不再收到 Trellis workflow-state。
- `rg -n "\.trellis|trellis-continue|trellis-finish-work" .codex .claude .agents AGENTS.md` 没有活动引用；文档和迁移记录中的历史说明除外。
- 卸载 diff 只删除 Trellis 管理内容，没有覆盖 Taskcraft 文件。

把卸载作为独立 commit。不要在同一 commit 升级 Trellis、修改 tc Adapter 或重写产品合同。

## 5. 启动 Taskcraft

卸载提交完成后，打开全新 Codex/Claude 会话：

```bash
tc init --agent codex
tc init --agent claude
tc enable ask
tc doctor
tc agent capabilities
tc agent test-hook
```

按实际 CLI 实现调整参数，但必须先通过 Store、migration、breadcrumb 和 Hook 检查。然后：

1. 创建一个低风险、局部、可回滚的 L1 dogfood 任务，验证新会话恢复与 done。
2. 创建一个需要独立 Review 的 L2 dogfood 任务，至少覆盖一次 pass 或 changes。
3. 依据迁移清单逐个创建仍有价值的后续 tc task，并保留 Trellis 来源引用；不要批量导入旧 status。
4. 观察期覆盖 waiting/resume、宿主 stale/恢复以及 Trellis 路径零写入。

第一张 tc 任务与最后一张 Trellis 任务不得在同一 Agent 会话中执行。

## 6. 验收

- tc 是唯一能改变活动开发任务状态的系统。
- 同一工作不存在 `.trellis/tasks` 与 Task Store 双份状态。
- 新会话只注入 Taskcraft breadcrumb，Trellis 目录保持不存在或只存在于历史 tag。
- 每项迁移后的长期规则只有一个权威位置。
- 第一张 L1 和第一张 L2 dogfood 任务有完整事实、evidence 与恢复记录。
- 文档入口改为 tc 日常工作方式，Trellis 手册只保留为历史迁移说明。

## 7. 回滚

仅在 Store 完整性失败、任务无法恢复、projector 产生不可解释状态或 Adapter 阻断宿主工作时回滚：

1. 停止创建新的 tc task，保存数据库、日志和诊断快照，不修改已写入 facts。
2. 关闭 Taskcraft Hook，在全新会话从切换 tag 恢复 Trellis 管理文件。
3. 创建新的 Trellis recovery task，引用失败的 tc task id；不把已写 facts 回写为 Trellis 状态。
4. 修复并重新满足进入条件后，再完整执行一次切换。

回滚只能切换活动工具，不能覆盖或删除 Taskcraft 已经记录的事实；任何时刻仍只有一个系统写活动任务。
