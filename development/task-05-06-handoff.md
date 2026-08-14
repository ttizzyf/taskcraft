# Task 05/06/07 交接说明（阶段已归档，Task 07 最终验收返工中）

> 更新日期：2026-08-14。本文件是给下一个会话 agent 的交接文档：Task 05（L3
> Feasibility 与 Integrate）和 Task 06（Watch）阶段已归档；Task 07 的代码返工
> 已完成，但最终宿主验收尚未通过。Task 07 已交付：`tc doctor`、waiting/resume/retry
> 公开闭环、Entry Hook 现场测试实现与真实宿主记录、run attach/status、`tc state`/`tc task list`、
> CLI 收敛与 L3 单 execute 收窄。L2 Review/done 与 Codex SessionStart 已补真实
> 样本；Entry Hook Diagnostics 与 `agent_runs` 单写入口也已修复并自动验证。
> ADR 0009 已移除 Stop Hook。**迁移门结论仍为 blocked**：公共 Codex/Claude
> `test-entry-hook` 待真实复核。见
> [`development/dogfood-2026-08-13.md`](dogfood-2026-08-13.md)与 Task 07
> 2026-08-14 复核快照。

## 一、当前状态

- **仓库**：Taskcraft，`main` 分支。
- **Task 00–06 均已提交并归档**（`.trellis/tasks/archive/2026-08/`）；该状态只描述
  Trellis 阶段任务，不代表 MVP 迁移门已经通过。
- **无活动 Trellis 任务**；Task 07 的最终返工尚未建立新任务。
- **当前基线**：contracts/、specs/、plans/ 与研究证据
  （host-smoke/l3-sample/l2-review-sample）在 development/ 下；Task 07 可在复核
  证据后同步修正合同与规范。
- `development/plans/roadmap.md` 已追加 Task 07；Task 00–06 的归档不等于 MVP
  迁移门已经通过。

## 二、Task 05/06 已完成的内容

```text
src/core/lifecycle/l3.ts            # L3 八节点图 + plan/integrate result schema
src/core/reducer/l3-materialize.ts  # L3 图物化 + result 校验
src/core/reducer/task-fact-add.ts   # taskFactAdd（append-only + 引用校验）
src/core/reducer/run-complete-nodes.ts  # plan/integrate 完成逻辑
src/commands/task-fact-add.ts       # tc task fact add
src/watch/server.ts                 # 127.0.0.1 随机端口 http 服务
src/watch/routes.ts                 # board/task/runtime/diagnostics 只读 API
src/watch/diagnostics.ts            # 诊断聚合
src/commands/watch.ts               # tc watch [--task|--port|--no-open]
watch/                              # 原生 ES modules 前端（index/app/render/detail/style）
development/contracts/fixtures/     # +8 个 L3 fixtures（l3-*）
development/l3-sample.md            # 可回放 L3 样本
tests/                              # 当前 392 用例 + Playwright 6 smoke
```

**可复用入口**：

- `taskFactAdd`（reducer 桶导出）；`TASK_FACT_CATEGORIES` 单一来源枚举。
- `createWatchServer(options)` / board/task/runtime/diagnostics API。
- 前端：`watch/render.js`（渲染纯函数）、`watch/detail.js`、hash 路由。
- `pnpm smoke:watch`（Playwright desktop/mobile）。

## 三、关键工程决策（新 agent 必须遵守，勿回退）

Task 02/03/04 全部决策仍适用，新增：

1. **Feasibility gate 不可绕过**：execute-1 仅当 review-plan-1（purpose=
   feasibility、outcome=passed、审核当前 revision 最新 plan attempt）satisfied
   才 runnable；blocked 时 next 指向 `tc review start --purpose feasibility
   --reviewed-attempt <plan-attempt>`；新 plan（changes successor / replan）
   必须重新 gate。
2. **integration review on-demand**：integrate result 的
   `modifiedDeliverables=true` 才触发 review-integrate-1；false/省略直入
   record（跳过义务 vacuous，done 推导不破坏）。
3. **L3 result schema 严格**（additionalProperties: false）：plan 的
   children/dependencies/validationOwners 是**对象数组**（不是字符串数组），
   integrate 的 integrationEvidence 是 evidence 对象数组——构造 result 时
   严格按 schema。
4. **Watch 页面数据 100% 来自 API**（无第二套推导）；无写端点（POST→405）；
   每请求独立 DB 连接（WAL 友好）；路径穿越防护（decode+resolve+isInside）。
5. **Review 独立性只用文本标签**（same-actor/unverified），无颜色夸大；
   Runtime observation 与 Task facts 视觉分层；stale/finished 与
   active/done 可并存。
6. **前端原生 ES modules**（无 bundler/框架）；`format:check` 未覆盖
   watch/ 与 playwright.config.ts（文件已按 prettier 格式，防回归建议纳入）。
7. **Playwright** 是 devDependency；其他机器首次跑 `pnpm smoke:watch` 前
   `pnpm exec playwright install chromium`。

## 四、验证命令

```bash
pnpm install --frozen-lockfile
pnpm check
git diff --check
pnpm smoke:watch                       # Playwright（需 chromium）
node dist/cli.js watch --no-open --port 0   # 起服务手动验证
```

## 五、下一步：Task 07 最终返工

1. **先读**：`development/plans/task-07-mvp-readiness-remediation.md` 的
   2026-08-14 复核快照；doctor、waiting/resume、Runtime、L3 和 L1/L2 样本
   已复验，不要重复判为缺失。
2. 用公开 `tc agent test-entry-hook --agent claude|codex` 复核 Entry 恢复路径；
   不得恢复已删除的 Stop Hook。不要把自动测试写成真实宿主证据。
3. Task 07 验收通过前不得卸载 Trellis；Trellis 与 Taskcraft 仍不设双写过渡期。
4. Task 07 验收通过后重新执行 `development/runbooks/trellis-to-taskcraft.md`
   的进入条件；只有结论为 pass 才在全新会话切换唯一活动系统。
5. 沟通语言：中文。
6. **不要**：为保住“Task 00–06 已完成”的表述而回避必要的合同修正；不要用
   fixture、mock marker 或 help 文本替代公开生产路径和真实宿主证据；不要动
   全局宿主配置。
