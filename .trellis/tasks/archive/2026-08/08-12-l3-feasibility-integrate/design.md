# Design: L3 feasibility review and integration

## Structural Judgment

复用 Task 03 review 四命令（purpose 分支已由 storage.sql trigger 支持
feasibility→plan / integration→integrate）与 Task 02/03 reducer 模式，
新增 L3 图、projector gate 与 taskFactAdd。不新增表。

## L3 Built-in Graph（src/core/lifecycle/l3.ts）

```text
nodes:
  frame-1 (frame)
  plan-1 (plan)                     -> outputSchema: { objectiveCoverage[],
                                        children[], dependencies[], 
                                        validationOwners[], integrationPath }
  review-plan-1 (review)            -> purpose=feasibility（审核 plan-1）
  execute-1 (execute)               -> 复用 L1/L2 execute schema
  review-execute-1 (review)         -> purpose=delivery（审核 execute-1）
  integrate-1 (integrate)           -> outputSchema: { childrenResults[],
                                        integrationEvidence[] }
  review-integrate-1 (review)       -> purpose=integration（审核 integrate-1）
  record-1 (record)
edges: frame-1 -> plan-1
       plan-1 -> review-plan-1
       review-plan-1 -> execute-1        # Feasibility gate
       execute-1 -> review-execute-1
       review-execute-1 -> integrate-1
       integrate-1 -> review-integrate-1
       review-integrate-1 -> record-1
obligations（required）:
  frame-1 / execute-1 / record-1         # 沿用 L2
  plan-1: plan-completed                 # plan result_json 结构校验过
  review-plan-1: feasibility-completed   # outcome=passed 的 feasibility review attempt
  review-execute-1: delivery-completed   # outcome=passed 的 delivery review attempt
  integrate-1: integration-completed     # integrate result_json 结构校验过
  review-integrate-1: integration-review-completed  # outcome=passed（若图含该节点）
```

review-integrate-1 是 **on-demand 节点**：Integrate 只做组合验证时可直入
record；修改代码/配置/冲突结果时必须生成 integration Review。Task 05 实现
为：integrate result 含 `modifiedDeliverables: true` 时 projector 将
review-integrate-1 投影 runnable，否则跳过（next 直指 record-1）。

## Projector Gate（修改 project()）

- review 节点 satisfied 判定扩展：按 review link 的 purpose 匹配被审核
  node kind（feasibility→plan、delivery→execute、integration→integrate），
  outcome=passed 才算 satisfied。
- execute-1 runnable 判定：前置节点（review-plan-1）satisfied 才 runnable；
  blocked 时 next 指向 `tc review start <id> --node review-plan-1 --purpose
  feasibility --reviewed-attempt <plan-attempt>`。
- integrate-1 runnable：review-execute-1 satisfied 且（on-demand 判定）。
- review-start 的 reviewed-attempt 参数默认解析：按 purpose 取当前 revision
  对应 kind 的最新 finished/success attempt。

## taskFactAdd（src/core/reducer/fact-add.ts）

```ts
taskFactAdd(db, input: TaskFactAddInput): TaskFactResult
// input: { taskId, expectedRevision?, attemptId, category, subject, value,
//          evidenceId?, supersedesFactId?, actorInstanceId? }
```

校验：source_attempt_id 属于当前 revision（TC_ATTEMPT_REF_INVALID）、
category 枚举（intent|probe|constraint|assumption|dependency|environment）、
subject 非空、value 为对象（TC_TASK_INPUT_INVALID）、evidence_id 存在且
同 task（TC_EVIDENCE_REF_INVALID）、supersedes_fact_id 同 task 存在。
写 task_facts（append-only，trigger 保护）+ 审计 event。secret 边界：
value 不做内容检查（spec 说 secret 永不落库由调用方负责，reducer 不额外
脱敏——记录在 Node Brief/命令说明）。

## Waiting(needs_decision) 路径

reducer 语义：fact-add 或 review 需要用户决定时写 open blocker
（kind=needs_decision / waiting_reason=needs_decision，remediation 提示用户
回答）；用户回答后写 constraint fact + blocker resolved（`task resume` 命令
不在本任务，resolver 由后续任务或 fixture 覆盖）。fixtures/测试验证 projector
waiting 投影。

## Error Codes（新增）

TC_FACT_INPUT_INVALID（category/subject/value 非法，或复用
TC_TASK_INPUT_INVALID）、TC_FACT_SUPERSEDE_INVALID（supersedes 引用非法）。

## Fixtures（新增 8 个，既有不动）

l3-pass / l3-feasibility-blocked / l3-fact-probe / l3-fact-expired /
l3-waiting-decision / l3-two-children / l3-conflict / l3-stale。
l3-two-children：execute 后两个 delivery 分支 obligation 一个未满足 →
integrate blocked；全满足 → runnable。

## Compatibility & Rollback

- 只增改 src/ 与新增 fixtures；冻结文件不动。
- feasibility gate 与 lifecycle.md §9.1 冲突时以 spec 为准。
- 每子任务完成 `pnpm check` 全绿为提交门槛。
