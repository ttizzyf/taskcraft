# Watch server and JSON API

## Goal

交付 localhost 随机端口 http 服务与只读 JSON API：Board/Detail/Runtime/
Diagnostics 数据全部消费同一 projector/query 模型，深链稳定，静态资源服务。

## Requirements

### REQ-01. Server Lifecycle

`tc watch [--task <id>] [--port 0] [--no-open]`：绑定 127.0.0.1 随机端口
（--port 0 默认）；打开浏览器（可禁用）；单会话生命周期（Ctrl-C 退出）；
`--no-open` 只打印 URL。

### REQ-02. JSON API（同源只读）

- `GET /api/board`：五状态分组 + 每卡摘要（标题/Level/status/节点/
  required 完成度/blocker/宿主/最后活动/next）。
- `GET /api/task/:id`：Detail 全量（目标/范围/验收/Level/判级理由/
  revision/节点图/义务完成度/evidence/findings/时间线/next）。
- `GET /api/runtime`：agent_runs observation 列表（与 Task facts 分层）。
- `GET /api/diagnostics`：hook/migration/revision conflict/evidence/
  unsupported host/timeout 聚合。
- 全部只读，数据来自 project()/query model；无写端点。
- 深链：`GET /#/task/<id>` 由前端 hash 路由处理（服务器只服务静态资源与
  API，不依赖服务器路由状态）。

### REQ-03. Static Serving

服务 `watch/` 目录的原生 ES modules 静态资源（index.html/app.js/style.css
等），正确 MIME 与缓存头（no-cache）。

### REQ-04. Tests

服务器测试（supertest 风格或原生 http）：随机端口绑定、API 形状与只读
（无写方法）、task 不存在 404、board 分组正确、深链路由、静态资源 MIME、
单会话退出。

## Acceptance Criteria

- [ ] 127.0.0.1 随机端口；`--no-open` 只打印 URL。
- [ ] API 全部只读且与 CLI JSON 同源（同一 project()/query 输出）。
- [ ] 深链在同一会话内稳定（hash 路由，不依赖服务器状态）。
- [ ] 新增文件有效行 ≤ 400；`pnpm check` 全绿。

## Non-goals

- 不实现前端页面（watch-frontend）；不实现写端点/WebSocket。
- 不引入框架/依赖（原生 node:http）。

## Notes

- 依赖已归档的 core/store（projector/query/adapter diagnostics）。
- API 形状以 product.md §5 信息架构为参考，但数据源唯一。
