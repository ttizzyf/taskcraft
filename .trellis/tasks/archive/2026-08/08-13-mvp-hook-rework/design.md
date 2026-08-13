# Design: hook rework

## test-hook 新流程

```text
tc agent test-hook --agent <a>
1. 读 config.json（takeOver 必须非 off）
2. 检查 .taskcraft/hooks/entry.sh + stop.sh 存在，且引用的 dist/hooks/*.js 存在
   （不存在 → TC_ADAPTER_HOOK_TEST_FAILED：scripts missing）
3. 检查项目配置注册（codex: .codex/config.toml 含 hooks.SessionStart/Stop
   指向 entry.sh/stop.sh；claude: .claude/settings.json 同）→ 未注册明确失败
4. codex：`codex features list` 探测 hooks feature + trust 状态 → 未满足失败
5. 用已安装脚本 + 真实 Task Store spawn 宿主最小 prompt（60s 超时）：
   - SessionStart/Entry：stdout 含 tc-breadcrumb/v1（注入判定）
   - Stop：exit 2 + breadcrumb（block 判定）
   - loop guard：stop_hook_active=true 输入 → exit 0（放行判定）
6. 结果写 config.hookTests[agent] = { testedAt, version, ok, enforced, failure? }
7. enforced = 注入 && block && loop guard 全过
```

## 失败语义

| 场景 | 结果 |
| --- | --- |
| hooks 脚本缺失/产物缺失 | exit 1 + TC_ADAPTER_HOOK_TEST_FAILED |
| 项目配置未注册 | exit 1 + TC_ADAPTER_HOOK_TEST_FAILED（不再 ok+limitation） |
| codex feature/trust 未满足 | exit 1 + TC_ADAPTER_HOOK_TEST_FAILED（cause 说明） |
| 注入/拦截/放行任一失败 | exit 1 + failure 详情 |
| 全过 | exit 0 + enforced=true |

## installEntry 同步

`installEntryFiles` 的"config exists"分支返回 ok=false（明确失败），
命令输出 remediation（`tc enable` 后重试 / 手动合并注册）。

## Tests

fake host 桩 + 临时目录：五类失败场景 + 成功场景；conformance 断言更新。
