# Implement: L3 multi-child decision

## Checklist

1. 复核偏差证据（读 l3.ts / fixture / lifecycle.md §5 / cli.md §4）。
2. 向用户提交决定（推荐 (b) 收窄单 execute）并记录理由。
3. 按决定实施：图/schema/校验/fixtures/测试同步（(b) 时删除多分支声称）。
4. specs 修订（lifecycle.md §5 标注；cli.md L3 示例如涉及）。
5. `pnpm check` 全绿 + `git diff --check`。

## Validation

```bash
pnpm check
git diff --check
```

## Commit

`docs: narrow L3 to single execute (MVP)` 或 `feat(core): materialize
per-child execute branches`（依决定）→ `trellis-check` →
`/trellis:finish-work` 归档。
