# Implement: Watch server and JSON API

## Checklist

1. `src/watch/server.ts` + `routes.ts` + `diagnostics.ts`。
2. `src/commands/watch.ts` + `src/cli.ts` 注册。
3. `watch/` 最小占位静态资源（index.html 骨架，前端子任务填充）。
4. tests/watch/server.test.ts（端口/API/404/405/MIME/穿越）。
5. `pnpm check` 全绿 + `git diff --check`。

## Validation

```bash
pnpm check
git diff --check
node dist/cli.js watch --no-open --port 0   # 打印 URL，curl 验证 API
```

## Review Gates

- API 全部只读；数据来自 project()/query；深链由前端 hash 路由（服务器
  不存路由状态）。
- 文件 ≤ 400 有效行；不新增 npm 依赖（原生 node:http）。

## Commit

`feat(watch): add localhost watch server and read-only JSON API`（或按内容
拆 feat/test）→ `trellis-check` → `/trellis:finish-work` 归档。
