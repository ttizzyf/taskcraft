# L3 graph and reducer semantics

## Goal

交付 L3 内置图、Feasibility gate 投影、`task fact add` reducer 语义、
integration review 路径与对应 fixtures/测试。

## Requirements

### REQ-01. L3 Built-in Graph

`src/core/lifecycle/l3.ts`：frame-1 → plan-1 → review-plan-1(feasibility) →
execute-1 → review-execute-1(delivery) → integrate-1 → review-integrate-1
(integration，可选) → record-1；plan 的 result schema（objective 覆盖 /
子任务拆分 / 依赖 / 验证责任 / 集成路径）；obligations 见父 prd REQ-01。
`taskNew --level 3` 物化；level 1/2 不变。

### REQ-02. Feasibility Gate（projector）

execute-1 的入边 = review-plan-1 satisfied（存在 outcome=passed 且 purpose=
feasibility 的 review attempt 审核当前 revision 的 plan attempt）；gate 未
满足时 execute-1 投影 blocked，next 指向 `tc review start ... --purpose
feasibility --reviewed-attempt <plan-attempt>`。review-plan-1 runnable =
plan-1 satisfied。integrate-1 的入边 = review-execute-1 satisfied（多分支
未满足前 blocked）。

### REQ-03. taskFactAdd

`taskFactAdd(db, input)`：校验 source_attempt_id 属于当前 revision、
category 枚举、subject 非空、value_json 可解析对象；append-only 写
task_facts + 审计 event（一个事务）。`supersedes_fact_id` 支持（可选）。

### REQ-04. Review 扩展

feasibility reviewStart（purpose=feasibility 审核 plan attempt）与
integration reviewStart（purpose=integration 审核 integrate attempt）——复用
Task 03 review 四命令；第二次 feasibility blocking 的三种处理路径
（修订 / 记录接受 / waiting(needs_decision)）在 reducer 语义与测试覆盖。

### REQ-05. Fixtures

新增：l3-pass（完整 L3 到 done）、l3-feasibility-blocked（plan 未过 →
execute blocked）、l3-fact-probe（probe fact append）、l3-fact-expired
（supersedes 链）、l3-waiting-decision（needs_decision blocker）、
l3-two-children（多分支 integrate 门）、l3-conflict、l3-stale（observation
stale 与 task 状态并存）。既有 fixtures 不动。

### REQ-06. Tests

feasibility gate（未过不可 runnable / 过后可 run）、新 plan 重新 review、
fact append-only 与引用校验、integration 门（多分支未满足 blocked）、
waiting 路径、旧事实可引用、CAS。单组 60s 硬超时。

## Acceptance Criteria

- [ ] Execute 在 feasibility passed 前投影 blocked 且 next 指向 feasibility review。
- [ ] 新 Plan 必须重新经过 Feasibility Review。
- [ ] fact 写为 append-only，secret 边界不落库。
- [ ] 多分支 required obligations 未满足前 Integrate blocked。
- [ ] 新增文件有效行 ≤ 400；`pnpm check` 全绿。

## Non-goals

- 不实现 CLI 命令（l3-cli-sample）；不实现 worktree/merge。
- 不新增表或改 storage.sql / 既有 fixtures。

## Notes

- 语义以父 design.md 为权威；复用 Task 03 review 四命令与 storage.sql trigger。
