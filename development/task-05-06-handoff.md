# Task 05/06 交接说明（L3 与 Watch 已完成，进入迁移）

> 更新日期：2026-08-13。本文件是给下一个会话 agent 的交接文档：Task 05（L3
> Feasibility 与 Integrate）与 Task 06（Watch 与 Diagnostics）已完成并归档，
> roadmap 全部阶段完成。下一步按
> [`development/runbooks/trellis-to-taskcraft.md`](runbooks/trellis-to-taskcraft.md)
> 执行 Trellis → Taskcraft 迁移。Task 02/03/04 交接见对应 handoff 文件。

## 一、当前状态

- **仓库**：Taskcraft，`main` 分支。
- **Task 00-06 全部完成、已提交、已归档**（`.trellis/tasks/archive/2026-08/`）。
- **无活动 Trellis 任务**。
- **上游产物**：contracts/、specs/、plans/ 冻结；研究证据
  （host-smoke/l3-sample/l2-review-sample）在 development/ 下。
- `development/plans/roadmap.md` 状态列已全部更新为完成。

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
tests/                              # 286 用例 + Playwright 6 smoke
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

## 五、下一步：迁移（trellis-to-taskcraft）

1. **先读**：`development/runbooks/trellis-to-taskcraft.md` →
   `development/plans/roadmap.md`（全部完成）。
2. 按 runbook：Trellis 与 Taskcraft 不设双写过渡期；冻结并卸载 Trellis
   开发任务系统，在新会话切换唯一活动系统为 Taskcraft 自身。
3. 迁移完成前：Trellis 仍是开发任务系统（本仓库 AGENTS.md 的 Trellis
   指令仍生效）；迁移完成后 Taskcraft 接管后续缺陷修复、性能优化与版本
   迭代。
4. 沟通语言：中文。
5. **不要**：改 Task 00-06 已冻结的 storage.sql、schemas、既有 fixtures、
   specs；不要动全局宿主配置。
