# Design: Taskcraft Watch and diagnostics views

## Structural Judgment

原生 ES modules（无 bundler/框架）：Node http 服务（watch-server）提供
只读 JSON API + 静态资源；`watch/` 目录的 HTML/CSS/JS 前端（watch-frontend）
消费 API。数据源唯一：project()/query model/adapter diagnostics。

## Module Shape

```text
src/
  watch/
    server.ts            # createWatchServer(options) -> http.Server
                         #   127.0.0.1 随机端口；路由：/api/* 与静态资源
    routes.ts            # board / task/:id / runtime / diagnostics 处理函数
    diagnostics.ts       # 聚合：hook/migration/revision conflict/evidence/
                         #   unsupported host/timeout（复用 adapter 与
                         #   TC_ADAPTER_* 输出）
src/commands/watch.ts    # tc watch [--task <id>] [--port <n>] [--no-open]
watch/
  index.html             # hash 路由（#/board、#/task/<id>、#/runtime、#/diag）
  app.js                 # fetch API + 渲染（原生 ES modules）
  style.css              # responsive：desktop 多列 / mobile 单列堆叠
```

## JSON API（routes.ts，全部只读）

| 端点 | 数据 | 说明 |
| --- | --- | --- |
| `GET /api/board` | 五状态分组 + 每卡摘要 | listTasks + project 每任务 |
| `GET /api/task/:id` | Detail 全量 | project() + query（attempts/evidence/obligations/findings/events/facts） |
| `GET /api/runtime` | agent_runs 列表 | query.getAgentRuns，含 observation_status |
| `GET /api/diagnostics` | 聚合诊断 | 见 diagnostics.ts |

- 深链：前端 hash 路由（`#/task/T-104`），服务器只服务静态资源与 API，
  不依赖服务器路由状态；同一 Watch 会话内深链稳定。
- 无写端点；404 显式。

## 页面（watch-frontend）

- Board：`#/board`——五组卡片；waiting 卡显示 waitingReason + remediation
  （责任方/恢复动作来自 blocker）。
- Detail：`#/task/<id>`——目标/范围/验收/Level/判级理由/revision/节点图
  （runnable/running/satisfied/blocked 状态符号）/义务完成度/evidence/
  findings（含 reviewed attempt/purpose/capability/independence——独立性
  用文本标签，不做颜色强调）/事件时间线/next 命令。
- Runtime：`#/runtime`——host/run id/node/attempt/last seen/finish reason，
  与 Task facts 独立视觉层级（独立面板）。
- Diagnostics：`#/diag`——TC_ADAPTER_*/migration/revision conflict 列表。
- app.js 只 fetch API 渲染，无第二套推导；加载失败显示错误。

## 状态矩阵（验收工具）

从 projector contract 生成用例清单（product.md §7）：五状态 × 视图断言、
L1/L2/L3 图、required 缺失、Review 三 outcome、stale/finished 并存、
revision conflict、unsupported host。smoke 用 Playwright（npmmirror
可用性在实现时先 `pnpm view playwright` 确认；不可用则用 vitest + 原生
http fetch 的 DOM 检查降级——计划要求 Playwright，优先尝试）。

## Compatibility & Rollback

- 只增 src/watch/、watch/、src/commands/watch.ts；冻结文件不动。
- 页面数据全来自 API；原型 watch.html 只作交互参考，不复制数据结构。
