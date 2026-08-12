# L3 CLI loop and sample

## Goal

把 L3 语义接成可执行的 CLI 纵切：`task new --level 3` → frame → plan →
feasibility review → execute → delivery review → integrate → record 完整
闭环，feasibility 回流与 integration 路径可走通，交付可回放 L3 样本。

## Requirements

### REQ-01. task fact add CLI

`tc task fact add <id> --attempt <id> --category <c> --subject <s> --value
<json|@path|@-> [--evidence <id>] [--supersedes <id>]`；category 枚举预校验；
失败非零退出 + 三件套。

### REQ-02. L3 CLI Loop

L3 闭环可完整走通（cli.md §4 L3 示例一致）：frame run/complete、plan
run/complete（result 含子任务拆分/依赖/验证责任/集成路径）、feasibility
review start/pass（--purpose feasibility --reviewed-attempt <plan-attempt>）、
execute run/complete、delivery review start/pass、integrate run/complete
（修改交付物时触发 integration review）、integration review start/pass、
record run/complete → done。feasibility changes_requested 回流（plan
successor → 重新 feasibility）与 replan 路径可走通。

### REQ-03. Replayable L3 Sample

`development/l3-sample.md`：完整命令序列 + 关键输出断言（revision 号、
attempt id、next）；临时目录真实执行验证后固化。样本覆盖 feasibility
passed 主路径与至少一条回流路径。

### REQ-04. CLI Integration Tests

spawn dist/cli.js：L3 主闭环到 done、feasibility gate（execute 不可提前
run）、feasibility changes 回流、integration 触发路径、fact add、退出码、
--json 同源。

## Acceptance Criteria

- [ ] L3 主路径真实闭环到 done（feasibility/delivery/integration 全 purpose 走通）。
- [ ] feasibility 未过时 `run --node execute-1` 被拒或 next 不指向 execute。
- [ ] 可回放样本逐条验证一致。
- [ ] fact add 成功写 append-only 事实并可查询。
- [ ] 新增文件有效行 ≤ 400；`pnpm check` 全绿；`git diff --check` 干净。

## Non-goals

- 不实现 worktree/merge/模型选择；不实现 `task wait/resume` 命令（blocker
  语义由 fixtures/测试覆盖）。
- 不改 core 语义（渲染/命令层只消费）。

## Notes

- 依赖已归档的 l3-graph-reducer；命令语义以 cli.md §4/§5 与父 design.md 为权威。
