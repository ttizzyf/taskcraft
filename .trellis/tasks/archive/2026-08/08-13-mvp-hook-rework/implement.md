# Implement: hook rework

## Checklist

1. `src/adapters/shared.ts`：installEntryFiles 部分成功改明确失败；
   runHookTest 支持"已安装脚本"模式（传脚本路径而非重装）。
2. `src/commands/agent.ts`：test-hook 新流程（检查/探测/真实链路/持久化
   config.hookTests）。
3. codex trust/feature 探测（features list + config 检查）。
4. tests：fake host 五失败场景 + 成功；conformance 更新。
5. `pnpm check` 全绿 + `git diff --check`。

## Validation

```bash
pnpm check
git diff --check
node dist/cli.js agent test-hook --agent claude   # 真实宿主（逐次授权）
```

## Commit

`fix(adapters): test-hook verifies installed hooks and fails explicitly`
→ `trellis-check` → `/trellis:finish-work` 归档。
