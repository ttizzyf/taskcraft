# Implement: Watch frontend views

## Checklist

1. `watch/index.html` + `watch/app.js` + `watch/style.css`（四视图 +
   hash 路由 + responsive）。
2. 渲染纯函数（app.js 内可测模块或独立 render.js）。
3. 状态矩阵用例（tests/watch/frontend.test.ts 或等效）。
4. Playwright smoke（先 `pnpm view playwright` 确认镜像可用性；不可用则
   降级方案并记录）。
5. `pnpm check` 全绿 + `git diff --check`。

## Validation

```bash
pnpm check
git diff --check
node dist/cli.js watch --no-open --port 0   # 配合前端子任务本地验证
```

## Review Gates

- 页面数据 100% 来自 API（无第二套推导）；无写操作入口。
- 独立性展示不夸大（文本标签）；stale/finished 并存正确。
- JS 文件有效行 ≤ 400（app.js 超出拆模块）。
- Playwright 不可用时的降级要显式记录。

## Commit

`feat(watch): add board, detail, runtime and diagnostics views`（或按内容
拆 feat/test）→ `trellis-check` → `/trellis:finish-work` 归档。

## After This Phase

父任务 Phase C 集成验收：起服务对照页面/CLI JSON/breadcrumb 状态一致性、
移动端检查、深链、更新 handoff、roadmap、父归档。
