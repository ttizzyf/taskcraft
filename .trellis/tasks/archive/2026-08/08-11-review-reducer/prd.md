# L2 review reducer semantics

## Goal

交付 L2 内置图与 review 四命令（start/pass/changes/replan）的 reducer 语义：
review link 与独立性披露、successor attempt、revision 切换与 supersede，以及
对应 fixtures 与核心测试。

## Requirements

### REQ-01. L2 Built-in Graph

`src/core/lifecycle/l2.ts`：frame-1 → execute-1 → review-1 → record-1 与四条
required obligations（frame-completed、requested-outcome-produced +
minimum-validation-recorded、review-completed、result-and-scope-retained）；
frame 的 output schema（objective/scope/acceptance）静态定义。`task new
--level 2` 物化 L2 图；level 1 不变；level 3 仍拒绝。

### REQ-02. Review Start

`reviewStart`：task active 且 review-1 runnable；reviewedAttemptId 属于当前
revision 的 execute attempt（否则 `TC_REVIEW_REF_INVALID`）；purpose 与
attempt kind 匹配（delivery→execute）；capability/independence 合法
（observed-distinct 必须 host-observed + 会话 id）；写 review attempt +
review link + 审计 event（一个事务）。不写 outcome。

### REQ-03. Review Pass

`reviewPass`：review attempt 未完结；evidence gate（至少一条属于 review
attempt 的 evidence，缺则 `TC_REQUIRED_EVIDENCE_MISSING` 零写入）；写
outcome=passed + finished + evidence 行 + review obligation satisfied +
可选 advisory finding + 审计 event。next → record-1。

### REQ-04. Review Changes

`reviewChanges`：写 blocking finding + 为被审核 node kind（execute）在当前
revision 创建 successor attempt（attempt_number+1）；scope/contract 不变；
原 execute attempt 保持 finished。next → successor execute 的 run complete。

### REQ-05. Review Replan

`reviewReplan`：一个事务内写 blocking finding + 新 lifecycle revision（typed
reason、reason、old/new diff、digest）+ `tasks.current_lifecycle_revision`
更新 + 旧 revision 的 created/running attempt 全部 superseded + 审计 event。
历史事实（旧 attempt/evidence/finding/revision）可查询，不隐藏。

### REQ-06. Projector Extension

next 按 node kind 生成：review-1 runnable → `tc review start ... --purpose
delivery --reviewed-attempt <id>`；review attempt 未完结 → `tc review pass
...`；其余沿用 L1。done 仍只由当前 revision 的 required obligations + record
推导。

### REQ-07. Fixtures & Tests

新增 6 个 fixtures（l2-pass / review-changes-requested / review-replan-required
/ review-same-actor / review-unverified / review-missing-evidence）；reducer/
事务测试覆盖三 outcome 原子性、supersede、零写入、evidence gate、CAS；
单组硬超时 60 秒。

## Acceptance Criteria

- [ ] Execute 与 Review 永远是不同节点和 attempt。
- [ ] 每个 Review 明确指向当前 revision 的一个可审核 attempt。
- [ ] same-actor 不能伪装成 observed-distinct；独立性能如实披露。
- [ ] changes_requested 不改变 scope/contract；replan_required 记录新合同、reason 与 diff。
- [ ] revision 切换事务无部分事实：旧 revision created/running attempt 全部 superseded。
- [ ] review pass 缺 evidence 时零写入并返回 `TC_REQUIRED_EVIDENCE_MISSING`。
- [ ] 新增文件有效行 ≤ 400；`pnpm check` 全绿。

## Non-goals

- 不实现 review CLI 命令（review-cli 子任务）。
- 不实现 L3 feasibility、`task promote/revise`、Web UI。
- 不新增表或改 storage.sql / 既有 fixtures。

## Notes

- 语义以父任务 design.md（L2 Built-in Graph / Review Command Semantics /
  Projector Extension / Error Taxonomy）为权威。
- 依赖已归档的 store-transaction 与 reducer-projector（L1）。
