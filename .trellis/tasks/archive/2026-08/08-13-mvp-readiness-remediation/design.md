# Design: MVP readiness remediation

## Structural Judgment

6 个子任务按文档拆分：A/B/C 可并行（独立命令面），D 依赖 B/C 的结果合同
（agent_runs 由 run attach 产生、Hook 结果由 test-hook 持久化），F 依赖
A–D（dogfood 用全部公开命令）。E 决定先于实现。父任务负责跨层一致性（
Watch 与 CLI 同源、cli.md 与 help 一致）与最终迁移门复核。

## 跨子任务设计约束

1. **公开命令唯一入口**：每项能力 = 唯一事实写入口（reducer）+ 公开命令 +
   同源投影 + 自动测试 + 适用真实宿主证据。禁止 fixture 插库冒充生产路径。
2. **命令面收敛策略（F）**：对 cli.md §2 一级命令逐项分类：
   - 实现：state（breadcrumb 命令化，hooks 改为调用它）、task list。
   - 延期标记：lifecycle、explain、task promote/revise/evidence add/export、
     --dry-run、--no-color、shell completion——cli.md 标注"deferred"，help
     不注册，示例不引用。
   - 被替代：无（state --breadcrumb 是 hooks 的内联替代，命令化后为正式路径）。
3. **Hook 结果持久化（C/D 合同）**：`.taskcraft/config.json` 增加
   `hookTests: { [agent]: { testedAt, version, ok, enforced, failure? } }`；
   test-hook 写、Watch diagnostics 读（同源）。
4. **agent_runs 公开路径（B/D 合同）**：`tc run attach` 写 agent_runs（
   reducer 内事务）；`tc run status` 读 observation + attempt 状态；
   `tc run retry` 需要失败事实（`tc run fail` 或 run complete 的 failure
   outcome 路径——B 决定公开触发方式）。
5. **L3 child 决定（E）**：向用户/决策点提交二选一；推荐 (b) 收窄单 execute
   （物化 per-child 分支会引入动态图编译，超出 MVP 范围；同步 lifecycle.md
   §5 与 l3 fixture 声称）。决定后同步合同与测试。

## Module Shape（新增/修改）

```text
src/commands/doctor.ts            # A
src/core/doctor.ts                # A：完整性检查纯函数（只读）
src/commands/task-wait.ts / task-resume.ts  # B
src/commands/run-retry.ts / run-fail.ts     # B（retry/failure 公开路径）
src/core/reducer/blocker.ts       # B：wait/resume/retry 写语义
src/hooks/shared.ts               # C：test-hook 改为测已安装 hooks
src/commands/agent.ts             # C/D：test-hook 结果持久化到 config
src/commands/run-attach.ts / run-status.ts  # D
src/commands/state.ts             # F：tc state --breadcrumb/--json
src/watch/routes.ts / diagnostics.ts        # D：hookTests/agent_runs 同源
```

## 关键不变式（回归保护）

- doctor 永不写库（BEGIN 只读或纯 SELECT + 内存校验）。
- wait/resume/retry 全部经 withTransaction + checkRevision + 事件连续性。
- test-hook 失败语义：未安装/未注册/未批准 → 非零退出 + TC_ADAPTER_*，
  不再 ok=true + limitation。
- Watch Runtime/Diagnostics 数据来源唯一（agent_runs 表 + config.hookTests）。
