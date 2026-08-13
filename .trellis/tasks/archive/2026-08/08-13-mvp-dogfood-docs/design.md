# Design: dogfood & doc sync

## CLI 收敛决策表

| 命令 | 决定 | 依据 |
| --- | --- | --- |
| state | 实现 `tc state --breadcrumb/--json` | hooks 内联逻辑命令化（唯一公开路径） |
| task list | 实现 | status 已用 listTasks，命令化 |
| lifecycle / explain | 延期（cli.md 标注 deferred） | advanced 类 |
| task promote / revise | 延期 | 非 MVP 必需 |
| task evidence add / export | 延期 | evidence 随 result 提交已覆盖 |
| --dry-run / --no-color / completion | 延期 | 脚本化增强 |

## Dogfood 序列（真实宿主，claude 优先）

```text
L1: init --agent claude → enable always → task new L1 → run →
    run complete(@path) → status done
waiting/resume: task new → run → task wait --reason needs_input →
    新进程 status(waiting) → task fact add(constraint 回答) → task resume →
    run complete → done
L2: task new --level 2 → frame/execute/review/record 全闭环（review pass）
跨会话恢复：完成任务前中断 → 新 claude -p 会话（Entry hook 注入 breadcrumb）
    → task next → 继续 → done
```

每步记录命令 + 断言；写 `development/dogfood-2026-08-13.md`（区分
verified/documented/blocked）。

## 迁移门复核表

按 runbook §1 逐条：doctor ✓（A）、migration/CAS ✓、waiting/resume ✓（B）、
Hook 可用（C 结果：claude enforced / codex 复验）、Node Brief 等合同冻结、
Watch ✓。输出 pass/blocked。

## 文档修正清单

- host-smoke：S5-S9 状态列改为 "local（测试覆盖）" 或 verified 加注；
  codex 保持 limited/advisory。
- README/roadmap/handoff：区分四种状态用词。
- cli.md：deferred 标注 + state/task list 移出 deferred。
