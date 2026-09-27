# Taskcraft Entry Hook 真实宿主复核（2026-09-26，Windows）

> 本记录取代 [`entry-hook-smoke-2026-08-17.md`](entry-hook-smoke-2026-08-17.md) 的
> 「Claude 尚未通过」结论。08-17 那份保留为当日历史记录，不再代表当前状态。
> 当前迁移判断以本记录为准。

## 当前结论

| 宿主 | 版本 | 公共命令 | 结果 |
| --- | --- | --- | --- |
| Claude | 2.1.177 | `tc agent test-entry-hook --agent claude` | `entryInjected: true`，8.8s，exit 0 |
| Codex | 0.155.1 | `tc agent test-entry-hook --agent codex` | `entryInjected: true`，15.5s，exit 0 |

两者均使用构建后的公开 `dist/cli.js`，在全新隔离项目初始化并创建 active L1 task；
结果写入各自 `.taskcraft/config.json` 的 `entryHookTests`，`tc agent capabilities`
同源展示。验证用临时项目与临时 trust 条目已在复核结束后移除。

**因此，迁移手册 §1 第 4 条**（Codex 与 Claude Adapter 的 Entry Hook 安装、任务恢复
和现场检测均已通过）**已具备完整证据**。

但迁移门**仍为 `blocked`**，原因已不是「Claude 证据未完成」，而是
[`runbooks/trellis-to-taskcraft.md`](runbooks/trellis-to-taskcraft.md) §1 的其余进入
条件尚未逐条重新复核。本记录只关闭第 4 条，不宣告整道门通过。

## 本次关闭的三个真实缺陷

复核过程中暴露并修复的缺陷，均已由自动测试复验：

1. **宿主启动失败（Windows）**。`test-entry-hook` 无法启动宿主，表现为 `ENOENT`。
2. **超时后子进程泄漏**。原 `defaultSpawn` 用 `spawnSync(..., {timeout, killSignal})`，
   Windows 上只终止直接子进程 `cmd.exe`，真正运行宿主的孙进程成为孤儿并继续运行
   （实测：超时后 6 秒孙进程仍写出 marker）。
   **关键约束**：`taskkill /PID <已退出 pid> /T /F` 无效（exit 128）——`/T` 依赖存活
   进程表解析进程树，根一退出孤儿即不可达。因此「先同步杀直接子进程、再事后补救」
   走不通，**必须改为异步并在根存活时杀树**。
   现为 `testEntryHook(): Promise<HookTestResult>` + `src/adapters/process.ts` 的
   `spawnCommand` / `terminateTree`（POSIX 负 pid 组杀 + 直接子进程回退；
   Windows `taskkill /T`）。`capabilities` 保持同步的有界只读探测。
3. **Codex 信任门在 Windows 上无法通过**。`~/.codex/config.toml` 的 trust 条目解析
   只接受双引号 basic 形式；而 Codex 自己写的是**单引号 literal** 形式
   （`[projects.'c:/users/wangjie']` 即证据），真实场景 100% 命中。
   修复：`PROJECTS_TABLE` 同时接受 basic / literal；`unescapeToml()` **只折叠
   `\\` 和 `\"`**（按完整 TOML 语义反转义会把小写路径 `\local\temp\` 变成制表符，
   而 Codex 恰恰写小写路径）；`sameProjectPath()` 按语义比较路径（分隔符归一化、
   去尾斜杠、Windows 折叠大小写），**仍要求精确项目路径，父目录信任不生效**。

## Claude 此前失败的原因（澄清）

08-17 与 09-09/09-10 记录中的 Claude 超时，**不是 tc 缺陷**。定位结论：

- 用户级 `~/.claude/settings.json` 钉死的默认模型出现 `429 cooling down`，
  Claude 重试退避后超过产品 60s 超时。
- 对照实验：手动加 `--model sonnet` 后 7.8s 完成，`result: "TC_FIRST"`，hook
  `exit_code: 0`。
- 产品 `TEST_HOOK_ARGS` 不带 `--model`。用户把默认模型切换后，公共命令一次通过。

即：**唯一阻塞是模型可用性，与 Entry Hook 链路无关。**

## 证据边界

- 只证明两个宿主在 Windows 本机上的 Entry 注入现场检测通过。
- **不证明** §1 其余进入条件已满足，也不等于 Trellis → Taskcraft 狗粮化迁移门通过。
- 自动测试、构造 breadcrumb 或历史 Stop smoke 都不能替代本记录中的真机证据。

## 后续验收

按 [`runbooks/trellis-to-taskcraft.md`](runbooks/trellis-to-taskcraft.md) §1 逐条复核
剩余进入条件（尤其第 3 条的真实宿主 L1/L2 创建/恢复/waiting/resume/Review/done 样本，
与第 6 条的 L1/L2/L3 公共 CLI 闭环），再判定迁移门能否由 `blocked` 转为 `pass`。
