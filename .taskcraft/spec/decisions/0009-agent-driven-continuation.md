# ADR 0009：Agent 自主推进与 Entry-only Hook

- 状态：已接受
- 日期：2026-08-14
- 范围：连续执行与宿主 Hook

## Context

Taskcraft 曾用 Stop Hook 在任务仍为 `active` 时阻止 Agent 正常结束当前轮次。
这种机制把“任务尚未结束”错误地等同于“Agent 不能结束这一轮”。当需求未澄清、
方向错误或目标暂时不可达时，强制续跑会激励 Agent 为了形式上的完成削弱测试、
添加隐藏 fallback、扩大范围或选择错误实现。

Taskcraft 已经拥有跨轮连续性所需的持久机制：Task Store、Node Brief、每条命令
返回的 `next`、typed `waiting`、blocker、obligation 和 Entry Hook 恢复。

## Decision

- Codex 与 Claude 只安装和注册 Entry Hook，不注册 Stop Hook。
- Codex 使用官方 `.codex/hooks.json` 三层事件结构；项目 trust 与具体 Hook 的
  `/hooks` 审核分别满足，现场测试不通过 bypass 参数跳过审核。
- Agent 在下一步清楚、安全且可执行时自主继续；不明确或受阻时提交 typed
  `waiting`，说明缺少的输入、决定或依赖。
- 正常结束一个 Agent 轮次不改变 Task 状态，不代表完成、失败、取消或 waiting。
- 后续轮次或会话由 Entry Hook 注入 breadcrumb，从 Task Store 的持久 `next`
  恢复。
- `tc agent test-entry-hook` 只验证真实 Entry 注入，并把结果写入
  `config.entryHookTests`。不保留 `test-hook` alias、Stop wrapper 或旧结果兼容层。
- 不引入 `/goal`、后台调度器或另一种阻止 Agent 结束的机制。

## Consequences

- `active` 任务可以跨越多个 Agent 轮次；这属于正常状态，不是失联证据。
- Agent 提前结束当前轮次不会被宿主 Hook 强行拉回，但任务事实仍然存在，下一
  会话可以恢复。
- 错误方向更容易在等待、澄清或人工复核边界停下，不必伪造“完成”。
- Taskcraft 尚未正式使用，本次采用开发期干净切换，不迁移旧 Stop 注册、旧
  `hookTests` 数据或临时 dogfood 目录。

## Rejected Alternatives

1. 保留 allow-only/no-op Stop wrapper：仍保留误导性的运行面和宿主复杂度。
2. 用 Stop Hook 实现 `/goal` 式强制完成：无法可靠区分值得继续与应当停下澄清。
3. 后台自动调度：扩大产品边界，且不能解决目标错误或需求不明确的问题。

## Contract Mapping

- lifecycle：Agent 自主推进、typed waiting、结束轮次不改变任务事实。
- architecture：Adapter 只负责 Entry 安装、现场测试和运行观察。
- CLI：`tc agent test-entry-hook`；结果存入 `config.entryHookTests`。
- product/Watch：Runtime 与 Diagnostics 只显示 Entry Hook 状态。

## Supersedes

本 ADR 取代 ADR 0004 中关于 Stop Hook、正常结束拦截和强制连续运行的决定。
ADR 0004 的历史探针证据、宿主能力披露、本地结果校验和 run correlation 决定
继续有效。
