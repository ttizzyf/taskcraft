# Implement: runtime observation & diagnostics

## Checklist

1. reducer：run-attach.ts（+ 桶导出）；commands：run-attach.ts、run-status.ts
   + cli.ts 注册。
2. config.hookTests 读写（shared config 模块扩展）+ agent capabilities 附
   最近测试行。
3. Watch：routes 的 runtime/diagnostics 读 agent_runs + hookTests（同源）。
4. tests：reducer/CLI/Watch 同源断言（attach 真实写入 → API 可见）。
5. `pnpm check` 全绿 + `git diff --check`。

## Validation

```bash
pnpm check
git diff --check
# 临时目录：attach → run status → watch /api/runtime 同一行
```

## Commit

`feat(cli): add run attach/status and persisted hook diagnostics`
→ `trellis-check` → `/trellis:finish-work` 归档。
