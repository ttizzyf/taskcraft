# Entry Hook 跨层实现合同

## 1. Scope / Trigger

修改以下任一边界时必须使用本合同：Host Adapter Hook 安装/现场测试、
`tc agent` 命令、`.taskcraft/config.json` 中的 Hook 测试记录、Watch Runtime 或
Hook Diagnostics。

权威产品行为见 `.taskcraft/spec/product/lifecycle.md` §7、`architecture.md` §9 和
`cli.md` §3。本文件只记录可执行的代码合同。

## 2. Signatures

```ts
interface HostAdapter {
  installEntry(input: InstallInput): InstallResult;
  testEntryHook(input: HookTestInput): Promise<HookTestResult>;
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

`testEntryHook` 是 Adapter 上唯一异步的方法：它是唯一会启动真实宿主进程的入口，
而超时必须终止整棵进程树，按 pid 杀树又要求进程仍然存活。`capabilities` 只做有界
只读探测，保持同步。

公共命令只有：

```text
tc agent test-entry-hook [--agent codex|claude]
```

## 3. Contracts

- `tc init --agent codex|claude` **同时写入两个等价 wrapper**：`.taskcraft/hooks/entry.sh`
  （bash）与 `.taskcraft/hooks/entry.mjs`（无 shell 的 Node gate），**只注册当前平台
  那一个**。POSIX 注册 `bash <abs>/entry.sh`；Windows 注册 `node <abs>/entry.mjs`，
  因为 Windows 宿主经 cmd.exe/PowerShell 执行 hook command，没有 bash。两个 wrapper
  都从自身位置推导项目根，都不依赖 cwd。安装同样注册 SessionStart，并保留已有
  非 Taskcraft 宿主配置；已有项目配置不会被覆盖。
- Codex 注册文件是 `.codex/hooks.json`，结构必须是
  `hooks.SessionStart[].hooks[]`，handler 必须包含 `type: "command"` 和项目内
  managed wrapper 命令。旧式扁平 `hooks.SessionStart = [{ command = ... }]` 不属于合同。
- 两个 wrapper 都在有 breadcrumb 时先输出非 JSON 文本标签，再输出 breadcrumb；不能把
  breadcrumb 作为裸 JSON stdout，否则 Codex 会把它误当 Hook 控制协议并拒绝。
- **两个 wrapper 的模板必须共用同一个路径归一化函数（`toPosixPath`）。**
  `entry.sh` 把 tc 路径嵌进 bash 双引号参数，`entry.mjs` 嵌进 JS 字符串字面量，
  两者都需要 POSIX 分隔符：Windows 路径的 `\` 在 bash 双引号里只在 `$`、`` ` ``、`"`、
  `\`、换行前有特殊含义，看似"碰巧能用"，但路径中出现这些字符就会断。
  历史上 `entryGateTemplate` 归一化了、`entryHookTemplate` 漏了，生成出
  `node "D:\proj\dist\cli.js"`——**只归一化一个模板等于没归一化**。
  测试断言也必须对称：两个 wrapper 的路径断言都要做 `replaceAll("\\", "/")`。
- Adapter 现场测试通过真实项目注册启动宿主。Claude 使用
  `--include-hook-events --output-format stream-json --verbose`，只接受成功的
  `SessionStart hook_response` 中通过既有 breadcrumb Schema 校验的摘要，并要求
  成功的模型 result；模型文本复述标记不是注入证据。Codex 保留宿主原有标记判定。
- **现场测试超时必须终止整棵进程树。** Windows 上宿主经 `cmd.exe /d /s /c` 启动，
  Node 知道的 pid 是 cmd.exe 而不是宿主：只杀直接子进程会把宿主留成孤儿继续运行。
  因此启动走 `spawnCommand`，超时走 `terminateTree`（POSIX 对 detached 进程组发负 pid
  信号、Windows `taskkill /PID <pid> /T /F`）。`taskkill /T` 依赖存活进程表解析进程树，
  根一退出孤儿即不可达，**不能等同步 spawn 杀完直接子进程之后再补救**。
- Codex 信任门按 TOML 语义解析 `~/.codex/config.toml`：`[projects.<path>]` 的键有两种
  字符串形式（basic `"C:\\me"` 与 literal `'C:\me'`），codex 为 Windows 路径写 literal
  形式；两者都必须接受，basic 形式只折叠 `\\` 与 `\"`。`trust_level` 必须锚定整行，
  注释掉的行不算生效；路径按语义比较（分隔符、尾部斜杠、Windows 大小写），但**仍要求
  精确项目路径，父目录信任不生效**。
- 测试结果只写 `TaskcraftConfig.entryHookTests[agent]`；CLI capabilities、Watch
  Runtime 和 Diagnostics 必须通过 `readEntryHookTests()` 读取同一来源。
- `tc enable off` 只验证 Entry gate 零输出。结束 Agent 轮次不改变任务状态。
- 后续会话通过 Entry breadcrumb 的 `detailCommand` 读取 `task show` 执行卡，
  结合 Projector `next` 恢复当前任务。

## 4. Validation & Error Matrix

| 条件 | 结果 |
| --- | --- |
| 当前平台的 managed wrapper 缺失，或它引用的 JS 不存在 | `TC_ADAPTER_HOOK_TEST_FAILED`，宿主不启动 |
| SessionStart 未指向项目内 `.taskcraft/hooks/entry.sh` 或 `entry.mjs` | `TC_ADAPTER_HOOK_TEST_FAILED` |
| takeover 为 `off` | `TC_ADAPTER_HOOK_TEST_FAILED`，说明先启用 `ask|always` |
| 没有唯一 active root breadcrumb | `TC_ADAPTER_HOOK_TEST_FAILED`，宿主不启动 |
| Codex hooks feature、精确项目根 trust 或 `/hooks` 定义审核不满足 | `TC_ADAPTER_HOOK_TEST_FAILED`，不得 bypass |
| 宿主超时、非零退出或输出缺 breadcrumb | 记录失败结果并非零退出；超时必须终止整棵进程树，不得留下孤儿宿主 |
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
- `tests/adapters/process.test.ts`：`commandSpec` 两平台分支（空参数、含空格、内嵌引号、
  cmd 元字符）与 `terminateTree` 真机杀树；后者用 marker 文件证明孙进程被杀，
  只杀直接子进程时必须失败。
- `tests/adapters/codex-trust.test.ts`：TOML 两种字符串形式、单引号值、父目录拒绝、
  注释拒绝、他人项目表拒绝、Windows 大小写与分隔符归一化。
- `tests/cli/entry-gate-script.test.ts`：Node gate 在 takeover off、无任务、非 active、
  配置缺失和正常注入下的输出。
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

### Wrong

```ts
// 只认 basic 形式：codex 为 Windows 路径写 literal 单引号形式，永远匹配不上。
const match = /^\[projects\."(.+)"\]\s*$/.exec(line);
// 子串匹配：注释掉的 # trust_level = "trusted" 也会被当成生效。
lines.some((line) => line.includes('trust_level = "trusted"'));
```

### Correct

```ts
// 两种 TOML 字符串形式都接受，锚定整行，路径按语义比较。
const PROJECTS_TABLE = /^\[projects\.(?:"((?:[^"\\]|\\.)*)"|'([^']*)')\]\s*$/;
const TRUSTED_LEVEL = /^\s*trust_level\s*=\s*["']trusted["']\s*(?:#.*)?$/;
sameProjectPath(section.path, projectDir);
```

Hook 安装、capabilities、现场测试和 Diagnostics 共用 `EntryHookTestRecord`，
不在消费者中定义平行的测试结果 schema。

Codex Hook 的结构和信任行为以 OpenAI 官方文档为准：
<https://developers.openai.com/codex/hooks>。
