# Implement: Taskcraft Watch and diagnostics views

## Execution Order

`watch-server` → `watch-frontend` → 父任务集成验收（状态矩阵 + 对照检查）。

## Ordered Checklist

### Phase A: watch-server 子任务

1. `task.py start` 08-12-watch-server。
2. `src/watch/server.ts` + `routes.ts` + `diagnostics.ts`（127.0.0.1 随机
   端口、静态服务、四 API 端点、404）。
3. `src/commands/watch.ts` + cli.ts 注册（--task/--port/--no-open）。
4. 测试：随机端口、API 形状与只读、404、深链路由、静态 MIME、退出。
5. `pnpm check` 全绿 → 提交 → `trellis-check` → 归档。

### Phase B: watch-frontend 子任务

1. `task.py start` 08-12-watch-frontend。
2. `watch/`：index.html + app.js + style.css（四视图 + hash 路由 +
   responsive）。
3. 状态矩阵用例（从 projector contract 生成）。
4. Playwright desktop/mobile smoke（先 `pnpm view playwright` 确认镜像；
   不可用则降级方案）。
5. `pnpm check` 全绿 → 提交 → `trellis-check` → 归档。

### Phase C: 父任务集成验收

1. 起服务 + 浏览器/无头访问四视图，页面状态与 CLI JSON 对照。
2. 核对父 prd.md AC 逐条（含移动端无重叠、深链稳定）。
3. 更新 `task-04-handoff.md` 为 Task 05/06 交接；roadmap 更新。
4. 父任务归档。

## Validation Commands

```bash
pnpm check
git diff --check
node dist/cli.js watch --no-open --port 0   # 打印 URL 后手动/无头验证
```

## Review Gates

- 页面数据必须来自 API（无第二套推导）；写端点零实现。
- Playwright 不可用时降级方案要显式记录，不静默跳过。
- 冻结文件出现 diff 时停止。

## Rollback Points

- Phase A API 形状问题：回 Plan 修正 design。
- Phase B 页面问题：只改 watch/。
