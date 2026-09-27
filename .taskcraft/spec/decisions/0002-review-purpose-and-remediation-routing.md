# ADR 0002：Review 结果与返工路由

- 状态：已接受
- 日期：2026-08-10
- 范围：Task 00

## Context

Review 需要说明审核了哪个 attempt，以及通过、修改或重做计划后去哪里。当前
R1/R2/R3、resolution 表和 purpose/kind 矩阵表达了同一件事，规则重复。

## Decision Drivers

- Review 必须引用准确的被审核 attempt。
- 每种结果必须有明确 next。
- 不为路由结果新增一张只重复 outcome/event 的表。
- 有独立 reviewer 时使用；没有时允许当前 Agent 完成 Review，并如实披露。

## Options

1. 保留 R1/R2/R3 和独立 resolution 实体。信息完整，但重复。
2. 只保留 `passed|changes_requested|replan_required`，用已有引用和 event 表达路由。
3. 所有问题都重新规划。规则少，但普通修改成本过高。

## Decision

采用选项 2：

- `passed`：当前 Review 完成，按 lifecycle edge 进入下一节点。Reviewer 做过
  修改时，把 diff 和验证作为 evidence 记录，不增加 `passed_with_fix` 状态。
- `changes_requested`：在当前 revision 为被审核 node 创建同 kind successor，
  修完后重新 Review。
- `replan_required`：创建新 lifecycle revision。
- `review_links` 保存 `reviewed_attempt_id` 和 purpose；`review_findings` 保存问题；
  outcome、successor 引用和 event 已足以说明处理结果，不新增
  `review_resolutions` 实体。
- Taskcraft 可以在 Node Brief 中建议独立 reviewer。是否派 subagent 由当前
  Agent 根据宿主工具决定；没有 subagent 时自己执行，并记录 `same-actor`。

## Consequences

- 只有三个结果，Agent 和 reducer 都更容易处理。
- Plan、Execute、Integrate 仍保留同 kind 历史链。
- 独立性是披露信息，不因为宿主缺少 subagent 自动卡住任务。

## Exit Cost

低。若以后需要单独统计 Reviewer 修复或强制独立审查，可从 evidence 和 event
验证需求后再增加字段，不预建实体。

## Contract Mapping

- lifecycle 定义三个 outcome 和 successor/revision 路由。
- CLI 把 review 结果提交到同一个 reducer command。
- SQL 删除 `review_resolutions`，保留 Review link、finding、attempt 和 event。

## Task 01 Input

Task 01 不实现 Review。后续 Review 任务只实现三个 outcome，不建立 resolution
repository 或额外路由层。

## Evidence

- `development/specs/lifecycle.md` 第 9 节。
- `development/specs/cli.md` 的 `review changes` transition。
- `development/contracts/storage.sql` 当前 `review_resolutions` 表与
  `r2_execute_successor` 约束。
