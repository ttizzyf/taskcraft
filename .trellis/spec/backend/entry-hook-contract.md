# Entry Hook 跨层实现合同

## 1. Scope / Trigger

修改以下任一边界时必须使用本合同：Host Adapter Hook 安装/现场测试、
`tc agent` 命令、`.taskcraft/config.json` 中的 Hook 测试记录、Watch Runtime 或
Hook Diagnostics。

权威产品行为见 `development/specs/lifecycle.md` §7、`architecture.md` §9 和
`cli.md` §3。本文件只记录可执行的代码合同。

## 2. Signatures

```ts
interface HostAdapter {
  installEntry(input: InstallInput): InstallResult;
  testEntryHook(input: HookTestInput): HookTestResult;
}

interface EntryHookTestRecord {
  testedAt: string;
  version: string | null;
  ok: boolean;
  failure?: string;
}

interface WatchRuntime {
  entryHookTests: Record<string, EntryHookTestRecord>;
}
```

公共命令只有：

```text
tc agent test-entry-hook [--agent codex|claude]
```

## 3. Contracts

- `tc init --agent codex|claude` 创建 `.taskcraft/hooks/entry.sh`，注册
  SessionStart，并保留已有非 Taskcraft 宿主配置；已有项目配置不会被覆盖。
- Codex 注册文件是 `.codex/hooks.json`，结构必须是
  `hooks.SessionStart[].hooks[]`，handler 必须包含 `type: "command"` 和项目内
  `entry.sh` 命令。旧式扁平 `hooks.SessionStart = [{ command = ... }]` 不属于合同。
- `entry.sh` 在有 breadcrumb 时先输出非 JSON 文本标签，再输出 breadcrumb；不能把
  breadcrumb 作为裸 JSON stdout，否则 Codex 会把它误当 Hook 控制协议并拒绝。
- Adapter 现场测试通过真实项目注册启动宿主。Claude 使用
  `--include-hook-events --output-format stream-json --verbose`，只接受成功的
  `SessionStart hook_response` 中通过既有 breadcrumb Schema 校验的摘要，并要求
  成功的模型 result；模型文本复述标记不是注入证据。Codex 保留宿主原有标记判定。
- 测试结果只写 `TaskcraftConfig.entryHookTests[agent]`；CLI capabilities、Watch
  Runtime 和 Diagnostics 必须通过 `readEntryHookTests()` 读取同一来源。
- `tc enable off` 只验证 Entry gate 零输出。结束 Agent 轮次不改变任务状态。
- 后续会话通过 Entry breadcrumb 的 `detailCommand` 读取 `task show` 执行卡，
  结合 Projector `next` 恢复当前任务。

## 4. Validation & Error Matrix

| 条件 | 结果 |
| --- | --- |
| `entry.sh` 缺失或引用的 JS 不存在 | `TC_ADAPTER_HOOK_TEST_FAILED`，宿主不启动 |
| SessionStart 未指向项目内 `.taskcraft/hooks/entry.sh` | `TC_ADAPTER_HOOK_TEST_FAILED` |
| takeover 为 `off` | `TC_ADAPTER_HOOK_TEST_FAILED`，说明先启用 `ask|always` |
| 没有唯一 active root breadcrumb | `TC_ADAPTER_HOOK_TEST_FAILED`，宿主不启动 |
| Codex hooks feature、精确项目根 trust 或 `/hooks` 定义审核不满足 | `TC_ADAPTER_HOOK_TEST_FAILED`，不得 bypass |
| 宿主超时、非零退出或输出缺 breadcrumb | 记录失败结果并非零退出 |
| Claude 事件损坏、SessionStart 失败、摘要无效或模型终态失败/缺失 | 记录失败，模型复述标记不能补足证据 |
| wrapper/gate 修改时间或宿主版本晚于记录 | Watch 使用 `TC_ENTRY_HOOK_VERSION_DRIFT` |

## 5. Good / Base / Bad Cases

- Good：唯一 active root task（可同时存在 active child）、Entry 注册正确、宿主输出
  root breadcrumb；记录 `ok: true`。
- Base：没有测试记录；capabilities 显示 never recorded，Watch 报
  `TC_ENTRY_HOOK_TEST_MISSING`。
- Bad：命令指向 `/wrong/.taskcraft/hooks/entry.sh`，即使尾部路径相同也必须在
  启动宿主前失败。

## 6. Tests Required

- `tests/adapters/conformance.ts`：两个宿主共享 Entry 能力、安装和现场结果。
- `tests/adapters/claude-entry.test.ts`：成功 Hook 与有效摘要、模型终态、损坏事件、
  失败 Hook 和仅模型复述；复用产品 breadcrumb validator，不维护平行 Schema。
- `tests/cli/agent-hook-test.test.ts`：缺脚本、错误路径、旧扁平注册、未注册、
  takeover off、无唯一 active、Codex feature/trust、缺 breadcrumb 和持久化。
- `tests/cli/init-agent.test.ts`：新安装的脚本集合与 SessionStart 注册结构准确。
- `tests/watch/runtime-hooks.test.ts`：共享 `entryHookTests`、注册/测试/版本诊断。
- `tests/watch/frontend-render.test.ts` 与 Playwright smoke：Runtime 渲染同一字段。

断言必须验证失败发生在真实宿主 spawn 之前的前置条件，不得用 mock 成功代替。

## 7. Wrong vs Correct

### Wrong

```ts
// 子串匹配会把 /wrong/.taskcraft/hooks/entry.sh 误判成有效注册。
command.includes("entry.sh");
```

### Correct

```ts
// 注册必须是项目绝对路径，或边界完整的项目相对路径。
referencesManagedEntry(command, projectDir);
```

Hook 安装、capabilities、现场测试和 Diagnostics 共用 `EntryHookTestRecord`，
不在消费者中定义平行的测试结果 schema。

Codex Hook 的结构和信任行为以 OpenAI 官方文档为准：
<https://developers.openai.com/codex/hooks>。
