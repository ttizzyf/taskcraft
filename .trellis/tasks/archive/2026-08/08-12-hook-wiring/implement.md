# Implement: Hook wiring and agent commands

## Checklist

1. `src/hooks/entry.ts`（decideEntry 纯函数 + IO 包装）、`src/hooks/stop.ts`
   （decideStop）。
2. `src/commands/init.ts` 扩展 `--agent`；新增 `src/commands/enable.ts`、
   `src/commands/agent.ts`；`src/cli.ts` 注册。
3. `.taskcraft/hooks/` 脚本模板生成 + 项目级配置注册纯函数
   （codex/claude 各自格式）。
4. tests：entry/stop 矩阵、install 幂等/不覆盖/全局零写入、enable 状态机、
   agent 命令 fake-host 路径、diagnostics。
5. `pnpm check` 全绿 + `git diff --check`。

## Validation

```bash
pnpm check
git diff --check
node dist/cli.js agent capabilities
```

## Review Gates

- 全局宿主配置零改动（测试断言）；`enable off` 零输出。
- 文件 ≤ 400 有效行；不新增 npm 依赖。

## Commit

`feat(cli): add takeover enable/agent commands and hook wiring`（或按内容拆
feat/test）→ `trellis-check` → `/trellis:finish-work` 归档。
