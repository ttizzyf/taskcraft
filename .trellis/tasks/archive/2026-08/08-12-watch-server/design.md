# Design: Watch server and JSON API

## Server

```ts
// src/watch/server.ts
export interface WatchServerOptions {
  port?: number;            // 缺省 0（随机）
  host?: string;            // 缺省 127.0.0.1
  projectDir: string;       // .taskcraft/ 所在目录（DB 路径解析）
  staticDir: string;        // watch/ 前端资源
  openBrowser?: boolean;
}
export function createWatchServer(options): Promise<{ server; port }>
```

- 原生 node:http；路由表：`/api/board`、`/api/task/:id`、`/api/runtime`、
  `/api/diagnostics`、静态资源（index.html/app.js/style.css，no-cache）。
- 所有 API 处理在独立 DB 连接（openDatabase + applyMigrations 后只读查询；
  每次请求打开/关闭，短连接避免 WAL 长事务）。
- 静态资源 MIME：html/js/css/json；路径穿越防护（resolve 后必须位于
  staticDir 内）。

## API 形状

- `GET /api/board` → `{ groups: { active: TaskCard[], waiting: [], queued: [],
  done: [], cancelled: [] }, generatedAt }`；TaskCard =
  { id, title, level, status, waitingReason, node, nodeKind,
  doneObligations, totalObligations, host, lastActivity, next }。
- `GET /api/task/:id` → project() 全量 + query 明细（attempts/evidence/
  obligationResults/findings/events/taskFacts/reviewLinks）。
- `GET /api/runtime` → getAgentRuns() 列表 + 汇总（按 task 分组）。
- `GET /api/diagnostics` → { items: [{ code, problem, impact, remediation,
  source }] }（聚合 TC_ADAPTER_*/migration/conflict/evidence 可检测项）。
- 未知 task → 404 JSON；未知路径 → 404。
- 无写端点（POST/PUT/DELETE → 405）。

## Commands

`tc watch [--task <id>] [--port <n>] [--no-open]`：启动服务 → 打印 URL
（http://127.0.0.1:<port>/#/board 或带 #/task/<id>）→ 非 --no-open 时
`open` 浏览器（macOS `open` 命令）→ 等待 Ctrl-C。

## Tests

- 随机端口绑定（0 → 实际端口 > 0）；127.0.0.1 绑定断言。
- API：board 分组（构造五状态任务）、task 明细形状、runtime、diagnostics。
- 404/405；静态资源 MIME 与 no-cache；路径穿越拒绝。
- --no-open 输出 URL 后保持运行（spawn + 信号退出）。
