# Implement: tc doctor

## Checklist

1. `src/core/doctor.ts`（7 项检查纯函数）。
2. `src/commands/doctor.ts` + cli.ts 注册（--json、退出码、未初始化不建库）。
3. tests/core/doctor.test.ts + tests/cli/doctor.test.ts（健康 + 逐类损坏 +
   零修改断言）。
4. `pnpm check` 全绿 + `git diff --check`。

## Validation

```bash
pnpm check
git diff --check
node dist/cli.js doctor --json
```

## Commit

`feat(cli): add tc doctor integrity checks` → `trellis-check` →
`/trellis:finish-work` 归档。
