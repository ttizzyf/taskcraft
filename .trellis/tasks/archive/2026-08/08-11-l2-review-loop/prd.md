# Implement L2 tracked workflow and review feedback

## Goal

在 Task 02 的 L1 内核上增量实现 `frame -> execute -> delivery review -> record`
闭环：独立 Review 节点与 attempt、reviewed attempt 关系与能力/独立性披露，
以及 `passed` / `changes_requested` / `replan_required` 三种 outcome 回流。
Review 回流在同一 reducer/projector 上扩展，不预建平行状态机。

## Background

- 来源需求是 `development/plans/task-03-l2-review-loop.md`。
- Task 02 已完成并归档：`withTransaction` / `checkRevision` / `project` /
  `taskNew/run/runComplete/cancel` 可复用；L1 图、fixtures 与 99 个测试就位。
  工程约束与 gotcha 见 `development/task-02-handoff.md`。
- 已冻结且本任务不得改动：storage.sql、schemas、既有 fixtures、specs/、
  plans/（roadmap 状态列除外）。
- 用户已确认：父 + 2 子任务（review-reducer / review-cli）；
  `task promote` / `task revise` 命令不在本任务。

## Requirements

### REQ-01. L2 Built-in Graph

静态定义 L2 图：`frame-1 -> execute-1 -> review-1 -> record-1`；required
obligations 为 frame 的目标/范围/验收明确、execute 的 requested-outcome-
produced + minimum-validation-recorded、review 的 review-completed、
record 的 result-and-scope-retained。复用 L1 的 result schema 与 evaluator
模式；L2 的 recommended/optional 节点（focused plan / research）不在本任务。
`task new --level 2` 从 `TC_TASK_LEVEL_UNSUPPORTED` 变为正常建卡并物化 L2 图。

### REQ-02. Review Command Reducer Semantics

- `review start`：创建 review attempt（独立节点/attempt）+ review link
  （purpose=delivery、reviewed_attempt_id、capability=context-only |
  manual-attach | host-observed、independence_status=observed-distinct |
  unverified | same-actor | unsupported）。storage.sql 的
  `review_links_node_kinds_*` trigger 已强制 purpose 与被审核 attempt kind
  匹配（delivery → execute），reducer 负责前置校验与稳定错误。
- `review pass`：review attempt outcome=passed + 满足 evidence gate（review
  required evidence 完整）+ 可选 finding（advisory）+ 审计 event；review
  节点 satisfied，进入 record。
- `review changes`：blocking finding + 为被审核 node kind（execute）在当前
  revision 创建 successor attempt；scope/contract 不变。
- `review replan`：blocking finding + 新 lifecycle revision（typed reason、
  reason、old/new diff、compiler 版本、digest）；同一事务把旧 revision 的
  created/running attempt 标记 superseded；新 revision 复用稳定 node id。
- 三个命令都由 reducer 校验结构、CAS（`--expected-revision`）、引用关系；
  不建立 resolution 表（outcome/successor/finding/evidence/event 已足够）。

### REQ-03. Projector Extension

- review 节点 runnable 判定（其入边 execute 满足且 review 未完成）；
  review satisfied 判定（存在 outcome=passed 的 review attempt）。
- changes_requested 后：execute successor attempt runnable（同 revision）；
  replan 后：新 revision 首个 runnable 节点可 run，旧 revision 事实保持
  可查询。
- done 仍只由当前 revision 的 required obligations 与 record 推导；
  observation 永不参与。

### REQ-04. L2 Review CLI

- `tc review start <id> --node review-1 --purpose delivery --reviewed-attempt
  <attempt-id> [--host <host>] [--capability <c>] [--independence <s>]
  [--expected-revision <n>]`、`tc review pass <id> --attempt <id>
  --reviewed-attempt <id> --evidence <id>`、`tc review changes <id>
  --attempt <id> --finding <text>`、`tc review replan <id> --attempt <id>
  --finding <text> [--reason <code>]`。
- 所有命令支持 `--json`；失败非零退出 + 稳定 code/impact/remediation。
- L2 闭环可完整走通：`task new --level 2 -> frame run/complete -> execute
  run/complete -> review start -> review pass -> record run/complete -> done`；
  以及 changes_requested 与 replan_required 回流路径。

### REQ-05. Fixtures

在 `development/contracts/fixtures/` 新增（只增不改既有文件）：
l2-pass、review-changes-requested、review-replan-required、review-same-actor、
review-unverified、review-missing-evidence。

### REQ-06. Tests & Sample

- Review link/outcome/evidence 合同测试；三种 outcome 的 reducer 与事务
  测试（失败零写入、supersede 原子性、revision 切换无部分事实）。
- CLI 集成测试（spawn dist/cli.js）：L2 闭环、changes/replan 回流、退出码。
- 可回放的 L2 实际样本：真实命令序列（init -> ... -> done 含 review），
  记录为文档或 fixture，验证旧 attempt、finding、successor、revision 均可
  查询。

### REQ-07. Non-goals

- 不实现 L3 Feasibility Review（Task 05）与 `task promote/revise` 命令。
- 不实现宿主级强身份证明，只准确披露已观察能力。
- 不实现 Web UI / Watch。
- 不引入平行状态机或新表（storage.sql 已含 review_links/review_findings）。

## Acceptance Criteria

- [ ] Execute 与 Review 永远是不同节点和 attempt。
- [ ] 每个 Review 明确指向当前 revision 的一个可审核 attempt。
- [ ] same-actor 不能伪装成 observed-distinct，但不硬性阻止 Review。
- [ ] `changes_requested` 不改变 scope/contract；`replan_required` 记录新合同、reason 与 diff。
- [ ] done 仍只由当前 required obligations 与 record 推导。
- [ ] revision 切换事务无部分事实：旧 revision 的 created/running attempt 全部 superseded，历史事实可查询。
- [ ] 失败命令非零退出，含稳定 code、impact、remediation。
- [ ] 新增文件有效行 ≤ 400；`pnpm check` 全绿；`git diff --check` 干净。

## Child Task Map

| 子任务 | 交付物 | 独立可检查点 |
| --- | --- | --- |
| `review-reducer` | L2 图、review 四命令 reducer 语义、successor/supersede、fixtures、核心测试 | 三种 outcome 事务正确；revision 切换原子；证据 gate |
| `review-cli` | review 命令面接线、L2 端到端闭环、可回放样本、CLI 测试 | L2 真实闭环到 done；changes/replan 回流；退出码 |

依赖顺序：`review-reducer` → `review-cli`；父任务负责共享 fixture、接口一致性与
最终纵切验收。

## Notes

- 规划必须从真实 L2 回流路径反推：先定 review 事务边界、revision 切换不变量
  与稳定错误，再拆实现。
- 子任务在各自 prd/design/implement 中细化；本文件是源需求集。
