# Real-host dogfood and doc sync

## Goal

用公开 CLI 在真实宿主完成 L1/L2 dogfood（创建/跨会话恢复/waiting/resume/
Review/done），收敛 CLI 命令面与 cli.md 一致，同步状态文档用词，最终给出
迁移门 pass 或 blocked 结论。

## Requirements

### REQ-01. 公开 CLI dogfood（真实宿主，逐次授权）

至少在一个真实宿主（claude 优先，codex 尽力）用公开 CLI 完成：
- L1：init → task new → run → complete → done。
- L2：含独立 Review（pass 或 changes 一次）。
- waiting/resume：真实 `tc task wait` → 新进程 `tc task resume` → 完成。
- 跨会话恢复：中断后新宿主会话 Entry 注入 breadcrumb → `tc task next`
  继续 → done。
- 样本只使用公开 CLI；记录命令序列 + 输出断言（revision/attempt id/next）。

### REQ-02. CLI 命令面收敛

逐项决定 cli.md §2 一级命令：state（命令化，hooks 改调它）、task list
（实现）、lifecycle/explain/promote/revise/evidence add/export/--dry-run/
--no-color/completion（延期 → cli.md 标注 deferred，help 不注册）；`tc
--help` 与 cli.md 一致；每命令有自动 smoke。

### REQ-03. 文档状态同步

区分"归档/实现完成/验收通过/真实宿主已验证"四种状态：
- README、roadmap、handoff、host-smoke 用词统一。
- fixture/纯函数测试不得标为真实宿主样本；codex Hook 复验前保持
  limited/advisory。
- 迁移手册进入条件逐条重跑。

### REQ-04. 迁移门复核

按 `runbooks/trellis-to-taskcraft.md` §1 进入条件逐条核对，输出 pass 或
blocked（带原因）；pass 时才允许后续执行卸载。

## Acceptance Criteria

- [ ] L1/L2 dogfood 真实样本落库（公开 CLI，含 waiting/resume 与跨会话恢复）。
- [ ] `tc --help` 与 cli.md 一致；延期命令在规范标注且 help 不注册。
- [ ] 文档用词区分四种状态；host-smoke 标注修正。
- [ ] 迁移门结论明确（pass/blocked + 逐条证据）。
- [ ] `pnpm check` / `git diff --check` / `pnpm smoke:watch` 全过。

## Notes

- 依赖 A–D 全部就绪（dogfood 用 doctor/wait/resume/attach/retry）。
- 真实宿主调用逐次授权；codex 不可用时记录 blocked 原因。
