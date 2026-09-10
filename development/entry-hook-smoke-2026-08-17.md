# Taskcraft Entry Hook 真实宿主复核（2026-08-17）

> 本记录评估 SessionStart Entry Hook 的安装、任务恢复和公共现场检测合同。
> 当前迁移判断以本记录中的宿主测试结果为准。

## 当前结论

| 宿主 | 版本 | 公共命令 | 结果 |
| --- | --- | --- | --- |
| Codex | 0.147.0 | `tc agent test-entry-hook --agent codex --json` | `ok=true`、`entryInjected=true`，verified |
| Claude | 2.1.220 | `tc agent test-entry-hook --agent claude --json` | 此前真实调用 60 秒超时，尚无成功记录，pending |

因此，Codex Entry 的真实宿主缺口已经关闭；Claude 仍未关闭。当前迁移手册要求
Codex 与 Claude Adapter 的 Entry 安装、恢复和现场检测全部通过，所以迁移门仍为
`blocked`，不能卸载 Trellis。

## Codex 证据边界

- 使用构建后的公开 `dist/cli.js` 在全新隔离项目初始化并创建 active L1 task。
- Codex 项目根 trust 与 `/hooks` 中具体 Hook 定义分别完成审核；两道信任门没有混为一谈。
- 现场测试没有使用 `--dangerously-bypass-hook-trust`。
- 真实模型输出包含 `tc-breadcrumb/v1`，Adapter 将宿主版本记录为 `0.147.0`。
- `entry.sh` 输出文本标签后再输出 breadcrumb，避免裸 JSON 被 Codex 当作 Hook
  控制协议解析。

以上只证明 Codex Entry 恢复链路可用，不证明 Claude 当前可用，也不等于整个
Trellis → Taskcraft 狗粮化迁移门已经通过。

## 后续验收

只需在满足项目注册、active root task 和宿主信任前提下，取得一次 Claude 公共
`test-entry-hook` 成功记录，并重新执行迁移手册的完整进入条件复核。自动测试、
构造 breadcrumb 或历史 Stop smoke 都不能替代该证据。
