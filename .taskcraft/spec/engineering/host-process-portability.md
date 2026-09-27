# 宿主进程启动与终止的跨平台合同

## 1. Scope / Trigger

修改以下任一边界时必须使用本合同：启动宿主 CLI（`codex`、`claude`）、给宿主进程设置
超时、终止宿主或其子进程、在 Windows 上执行 hook / 现场测试命令。

权威产品行为见 `.taskcraft/spec/product/architecture.md` §9 与 `cli.md` §3。
本文件只记录可执行的代码合同与已验证的平台事实。

## 2. Signatures

```ts
// src/adapters/process.ts（产品侧自包含，不反向依赖 evals/）
export const IS_WINDOWS: boolean;

export interface CommandSpec {
  file: string;
  args: string[];
  verbatim: boolean;
}

export function commandSpec(
  command: string,
  args: readonly string[],
  platform?: NodeJS.Platform, // 可注入，两个分支才能在任意平台被单测覆盖
): CommandSpec;

export function spawnCommand(
  command: string,
  args: readonly string[],
  options?: SpawnOptions,
): ChildProcess;

export function terminateTree(pid: number | undefined, force: boolean): void;
```

`evals/core/process.ts` 提供同一模式的 `spawnCommand` / `execFileCommand` /
`terminateTree`。两侧实现各自独立：产品不得 import evals。

## 3. Contracts

### 3.1 启动

- Windows 上 `spawnSync("claude")` 必然 **ENOENT**：npm 装的是无扩展名 POSIX shim、
  `claude.cmd`、`claude.ps1`，而 CreateProcess 只会自动补 `.exe`。
- `spawnSync("claude.cmd")` 必然 **EINVAL**：批处理必须经终端，Node 明确拒绝。
- `shell: true` 能解析 shim，但**参数会被 cmd.exe 重新解析**：含空格的参数被拆开、
  `""` 空参数整个消失、带引号的 JSON 载荷丢引号。
- 正解：拼命令行走 `cmd.exe /d /s /c`，逐参数显式引号，并设置
  `windowsVerbatimArguments: true`。空参数必须写成 `""`——不加引号会从命令行消失，
  导致后续 flag 整体左移（`--tools ""` 会吃掉后面的 `--model`）。
- POSIX 直接启动命令，不经过任何 shell。

### 3.2 终止

- **走 cmd.exe 就多了一层进程。** Node 拿到的 pid 是 cmd.exe，不是宿主。
  只杀直接子进程会把宿主留成孤儿继续运行。
- **`taskkill /PID <已退出的 pid> /T /F` 无效**（exit 128，"找不到进程"）：`/T` 靠
  **存活进程表**解析进程树，根一退出，后代即不可达。因此
  `spawnSync` / `execFileSync` 的 `timeout` 一旦生效，进程树就已经丢失、无法事后补救。
- 推论：**凡带超时的宿主启动，seam 必须是异步的**，在根存活时按 pid 杀树。
  `HostAdapter.testEntryHook` 因此返回 `Promise<HookTestResult>`。
- POSIX 侧子进程要 `detached: true` 自领进程组，负 pid 才杀得到后代；组不存在时
  退回杀直接子进程。Windows 不 detached（会闪控制台窗口），靠 `taskkill /T` 走树。
- 计时器回调里若杀树抛错，**必须再补一次 `child.kill()`**：否则直接子进程不死、
  `close` 事件不来，调用方永远挂住而不是报超时。

### 3.3 宿主工具与 hook

- Windows 宿主没有 bash。hook command 必须注册无 shell 的 Node gate，
  与 POSIX 的 bash wrapper 等价（见 [Entry Hook 合同](entry-hook-contract.md)）。
- Windows 版 Claude Code 暴露的 shell 工具是 `PowerShell` 而不是 `Bash`；
  声明工具时两者都要给，否则 actor 没有任何命令执行能力。

### 3.4 同步与异步：`spawnSync` 的 stdin 管道陷阱

- **产品侧只允许异步 `spawn`。** 同步路径既无法在根存活时杀树（§3.2），
  又有下面这个陷阱。
- `spawnSync` 默认 `stdio: "pipe"`，会为 stdin 建一条额外管道。
  本机环境下这条管道的创建**必然失败**，返回
  `{ status: null, stdout: undefined, error: EBUSY }`——**不是**被信号杀死。
  实测：`stdio` 里 stdin 为 `"pipe"` 必失败、为 `"ignore"` 必成功，
  与 stdout/stderr、cwd、node 版本、`NODE_OPTIONS`、沙箱开关均无关；
  **异步 `spawn` 同参数完全正常**。
- 后果：断言写成 `expect(result.status).toBe(0)` 时，全部退化为
  `expected null to be 0`。一个共享 helper 就能让整个测试面假红，
  并顺带掩盖真正的新失败——**"失败数没变"不等于零回归**。
- 合同：**调用方不喂 stdin 时，不得请求 stdin 管道。**

  ```ts
  stdio: input === undefined ? ["ignore", "pipe", "pipe"] : "pipe",
  ```

- **真需要 stdin 的用例不要放弃覆盖，改用异步 `spawn`。**
  `tests/cli/helpers.ts` 的 `runCli` 故意**不接受** `input` 参数，让这个坑不可能被重新引入；
  需要喂 stdin 的用例走 `runCliWithStdin(args, cwd, input)`（异步 `spawn` + 写完后
  `stdin.end()` 让 CLI 看到 EOF），配合 `withInitializedDirectoryAsync` 使用。
  只有异步路径能在本机建出 stdin 管道——所以这不是"绕过环境"，而是换到可用的机制上。

## 4. Validation & Error Matrix

| 条件 | 结果 |
| --- | --- |
| 宿主命令在 Windows 上不经 cmd.exe 启动 | ENOENT / EINVAL，宿主不可达 |
| 参数含空格或空串且未显式引号 | 参数被拆开或消失，宿主收到错误的 flag 组合 |
| 超时只杀直接子进程 | 宿主成孤儿继续运行，字段测试已放弃但进程仍在 |
| 对已退出的 pid 调 `taskkill /T` | exit 128，孤儿不可达，静默失败 |
| 杀树失败后未补 `child.kill()` | 调用方永久挂起，不报超时 |
| hook 命令写 bash wrapper 但平台是 Windows | 宿主静默不执行，Entry 无输出 |
| `spawnSync` 未喂 stdin 却请求了 stdin 管道 | `status: null` + `error.code === "EBUSY"`，断言全部假红 |
| 用"失败数没变"判定零回归 | 同因假红掩盖真实回归；须核对失败原因并做对照实验 |

## 5. Good / Base / Bad Cases

- Good：Windows 上宿主经 `cmd.exe /d /s /c` 启动、参数完整送达；超时在根存活时
  `taskkill /T` 杀掉整棵树，字段测试在超时预算内返回 `timedOut: true`。
- Base：POSIX 直接启动命令，超时对 detached 进程组发负 pid 信号。
- Bad：用 `spawnSync(..., { timeout })` 启动 Windows 宿主——超时后宿主仍在跑。

## 6. Tests Required

- `tests/adapters/process.test.ts`：`commandSpec` 两平台分支（空参数、含空格、
  内嵌引号、cmd 元字符 `& | > ^`）；`terminateTree` 真机杀树——用
  `cmd.exe → node → node` 三层结构 + marker 文件证明孙进程被杀。
- `evals/tests/process.test.ts`：参数保真（空参数、带引号 JSON 载荷、含空格的工具模式）。
- **测试里用 `spawnSync` 时 stdin 一律给 `"ignore"`**（除非该用例真的要喂数据）。
  需要 stdin 的用例走 `runCliWithStdin`，不要塞进通用 helper——
  否则整个套件假红，且新增用例的失败也会被一起掩盖。
- 平台语义不可表达的用例用 `it.skipIf(process.platform === "win32")` 标注并写明原因
  （如 `chmod 000` 造不可读文件、`child.kill("SIGINT")`），不要留着永远红。
  跳过之前先确认该用例覆盖的是真实特性：是 → 换机制让它真跑（见上），不是 → 才跳过。

## 7. Wrong vs Correct

### Wrong

```ts
// 超时只杀掉 cmd.exe，宿主变成孤儿继续运行（实测：超时后 6s 孙进程仍写出 marker）。
const result = spawnSync(spec.file, spec.args, { timeout, killSignal: "SIGKILL" });
```

### Correct

```ts
// 在根存活时杀整棵树。
const child = spawnCommand(command, args, options);
const timer = setTimeout(() => {
  timedOut = true;
  try {
    terminateTree(child.pid, true);
  } catch (error) {
    killFailure = describeError(error);
    child.kill("SIGKILL"); // 否则 close 永不来，调用方挂住
  }
}, options.timeoutMs);
```

回归测试必须做**对照实验**：把实现换成"只杀直接子进程"后测试必须失败，
否则它没有在测它声称要测的东西。

### Wrong

```ts
// 调用方不喂 stdin，却仍为它建一条管道：本机必然 EBUSY，status 变 null。
const result = spawnSync(process.execPath, [CLI_PATH, ...args], {
  cwd,
  encoding: "utf8",
});
```

### Correct

```ts
const result = spawnSync(process.execPath, [CLI_PATH, ...args], {
  cwd,
  input,
  encoding: "utf8",
  stdio: input === undefined ? ["ignore", "pipe", "pipe"] : "pipe",
});
```
