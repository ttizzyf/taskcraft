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
  （bash）与 `.taskcraft/hooks/entry.mjs`（无 shell 的 Node gate）。Claude 的 settings
  没有 Windows 覆盖字段，两个平台都注册 Node gate；Codex 的注册同时携带 POSIX 形式与
  `commandWindows` 形式，由宿主按平台取用。注册内容不随生成平台变化。
- **注册命令不得包含任何与本机相关的绝对路径。** 两个宿主都以会话当前目录运行
  hook，从子目录启动时裸相对路径会失效，因此注册用宿主文档给出的「项目根锚点」：
  Claude Code 用 `${CLAUDE_PROJECT_DIR}/.taskcraft/hooks/entry.*`（由 Claude Code 自身
  替换，不交给 shell），Codex 用 `$(git rev-parse --show-toplevel)/.taskcraft/hooks/entry.*`。
- **不得把锚点改写成某个 shell 的专有语法。** Codex 用**会话自己的 shell** 执行 hook
  命令，Windows 上不一定是 cmd.exe：实测 Codex 0.163.0 在 Windows 经 PowerShell 执行，
  cmd 的 `for /f` 在那里是解析错误（`关键字"for"后缺少左括号"("`），hook 以非零退出，
  Entry 脚本根本没跑。`$(...)` 在 PowerShell 与全部 POSIX shell 中都是命令替换，因此
  Windows 覆盖字段 `commandWindows` 沿用同一个锚点，只把目标换成不依赖 bash 的 Node
  gate：`node "$(git rev-parse --show-toplevel)/.taskcraft/hooks/entry.mjs"`。注册校验
  也不再接受 `%i` 这类 cmd 专有锚点。
  两者都是项目相对定位，clone 后可直接使用，`.codex/hooks.json` 与
  `.claude/settings.json` 都可提交。
- **注册校验必须同时读 `command` 与 `commandWindows`**：任一字段命中项目根锚点即为
  已注册，只认 `command` 会把 Windows 上真正生效的那条判成未注册。
- **wrapper 也从项目解析 CLI，不记录安装机的路径。** 依次尝试
  `<项目根>/dist/cli.js`、`<项目根>/node_modules/taskcraft/dist/cli.js`，最后回退到
  PATH 上的 `tc`。候选列表由 `CLI_CANDIDATES` 单一来源生成，两个模板与前置校验共用，
  模板改了校验不会留在旧顺序上。**Windows 上的 PATH 回退必须经 `cmd.exe /d /s /c`
  启动**：npm 装的是 `.cmd` shim，`execFileSync` 直接执行会得到 EINVAL，hook 会静默
  以非零退出。两个 wrapper 都从自身位置推导项目根，都不依赖 cwd。安装同样注册
  SessionStart，并保留已有非 Taskcraft 宿主配置；已有项目配置不会被覆盖。
- **前置校验按 wrapper 的真实解析方式判断，不解析 wrapper 文本里的路径字面量。**
  `checkInstalledScripts` 分两类：带 managed 标记的 wrapper（两个模板首行都有）按
  「项目根候选 → PATH 上的 `tc`」的顺序确认 CLI 可解析；其他 wrapper 则要求它自己
  引用的目标存在（相对字面量按项目根解析）。任何一类里，**绝对路径目标都是对
  「本机存在该文件」的具体断言**，缺失即失败。回归方式：用 `installEntry` 真实生成的
  wrapper 跑 `checkInstalledScripts`，而不是手写 fixture —— 手写 fixture 会让 wrapper
  的解析逻辑变化后校验悄悄失效。
- Codex 注册文件是 `.codex/hooks.json`，结构必须是
  `hooks.SessionStart[].hooks[]`，handler 必须包含 `type: "command"` 和项目内
  managed wrapper 命令。旧式扁平 `hooks.SessionStart = [{ command = ... }]` 不属于合同。
- 两个 wrapper 都在有 breadcrumb 时先输出非 JSON 文本标签，再输出 breadcrumb；不能把
  breadcrumb 作为裸 JSON stdout，否则 Codex 会把它误当 Hook 控制协议并拒绝。
- 两个 wrapper 都不得内嵌安装机的绝对路径；模板里出现的路径只能是项目相对的。
  回归方式：生成后断言内容不包含 `process.cwd()`。
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
| 当前平台的 managed wrapper 缺失，或它解析不到 CLI（项目根候选与 PATH 上的 `tc` 都没有） | `TC_ADAPTER_HOOK_TEST_FAILED`，宿主不启动 |
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
- `tests/adapters/installed-hooks.test.ts`：用真实安装的 wrapper 校验前置检查
  （项目内 CLI、node_modules 候选、PATH 回退、两者都缺失、手写 wrapper 的缺失绝对
  目标），以及 Codex Windows 注册串在会话 shell（PowerShell）里真实执行并跑通到项目
  CLI、PATH 回退经命令解释器到达全局 `tc`。
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
// 注册必须锚定项目根（宿主占位符/锚点），或边界完整的项目相对路径。
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
