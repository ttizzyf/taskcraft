# Implement: HostAdapter core and conformance

## Checklist

1. `src/adapters/types.ts`（接口与类型）。
2. `src/adapters/codex.ts`、`src/adapters/claude.ts`。
3. `src/core/node-brief.ts`（宿主格式渲染）。
4. `tests/adapters/conformance.ts` + `codex.test.ts` / `claude.test.ts` +
   fake host 桩（tests/helpers/fake-host.ts）。
5. `pnpm check` 全绿 + `git diff --check`。

## Validation

```bash
pnpm check
git diff --check
```

## Review Gates

- capabilities 永不 crash；testHook 全部失败路径经 fake host 覆盖。
- 文件 ≤ 400 有效行；不新增 npm 依赖；不写全局配置。

## Commit

`feat(adapters): add host adapter interface and codex/claude implementations`
（或按内容拆 feat/test）→ `trellis-check` → `/trellis:finish-work` 归档。
