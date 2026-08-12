# Real-host smoke and records

## Goal

在真实 Codex 与 Claude 宿主上执行 Gate H1 六类样本并记录结果，验证
零注入、anchor-only 注入、Stop 连续执行与中断后恢复；如实区分"文档支持"
与"本机真实验证"。

## Requirements

### REQ-01. Six Real-host Samples

ordinary（普通问答零注入）、off（零注入零写入）、active（anchor + 唯一
next）、waiting、done、timeout / malformed hook——对 codex 与 claude 各执行
并记录。执行边界：临时目录 + 项目级临时配置；**付费调用逐次向用户确认**；
只读探针自动跑。

### REQ-02. Stop Enforcement Record

记录每个宿主的 Stop 连续执行结果（第一次 block、同一 session/turn 继续、
第二次 stop_hook_active 后 allow）；只有真实 Stop smoke 通过的宿主才报告
`enforced`，其余 `advisory`。

### REQ-03. Recovery After Interrupt

用户中断后从 Task Store 恢复的样本：中断 → 新会话 Entry 注入 breadcrumb →
`tc task next` 继续 → 完成。

### REQ-04. Smoke Records

`development/` 下 smoke 记录文档：每个样本的宿主/版本、命令、输出摘要、
结果与限制；"文档支持"与"本机真实验证"分列（沿用 host-feasibility.md
规则）；记录写回的唯一规范位置。

## Acceptance Criteria

- [ ] 六类样本在可用宿主上执行并有记录；不可用的宿主记录失败原因。
- [ ] enforced/advisory 如实披露（真实 Stop smoke 通过才 enforced）。
- [ ] 全局宿主配置零改动（执行记录中可见）。
- [ ] observation 的 finished 不直接标记任务 done（样本断言）。
- [ ] 记录文档区分"文档支持"与"本机真实验证"。

## Non-goals

- 不自动运行付费调用（每次执行前确认）。
- 不修复宿主问题掩盖失败；失败记录原因。
- 不改产品代码（若发现缺陷 → 报告主流程回 hook-wiring 修复）。

## Notes

- 依赖已归档的 adapter-core 与 hook-wiring；样本执行需用户逐次授权。
