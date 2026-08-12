# Implement: Real-host smoke and records

## Checklist

1. 与用户确认第一批真实宿主调用（列出命令与用途）。
2. 逐样本执行（临时目录 + 项目级临时 hook 配置）：ordinary / off /
   active / waiting / done / timeout-malformed（codex 与 claude 各一遍，
   不可用的宿主记录失败原因）。
3. Stop enforcement 记录（block → continue → allow 序列）。
4. 中断恢复样本（中断 → breadcrumb → next → 完成）。
5. 写 `development/host-smoke-2026-08.md` 记录（区分文档支持/本机实测、
   enforced/advisory）。
6. 若发现产品缺陷 → 报告主流程（回 hook-wiring 修复），不掩盖。
7. `pnpm check` 全绿 + `git diff --check`（记录文档不破坏构建）。

## Validation

```bash
pnpm check
git diff --check
```

## Review Gates

- 每次付费真实调用前向用户确认。
- 全局宿主配置零改动（执行前后 diff 检查）。
- 失败样本如实记录，不重试不掩盖。

## Commit

`docs: add real-host smoke records`（+ 可能的 `fix(...)` 缺陷修复）→
`trellis-check` → `/trellis:finish-work` 归档。

## After This Phase

父任务 Phase D 集成验收：核对父 prd AC、更新 handoff 交接、roadmap 状态、
父任务归档。
