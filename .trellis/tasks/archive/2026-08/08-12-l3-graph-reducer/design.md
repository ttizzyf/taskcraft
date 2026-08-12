# Design: L3 graph and reducer semantics

## 接口

```ts
// src/core/lifecycle/l3.ts
export const L3_NODES / L3_EDGES / L3_OBLIGATIONS / L3_FRAME... 同 L2 模式
export const L3_PLAN_RESULT_SCHEMA     // objectiveCoverage[] / children[] /
                                       // dependencies[] / validationOwners[] /
                                       // integrationPath
export const L3_INTEGRATE_RESULT_SCHEMA // childrenResults[] /
                                        // integrationEvidence[] /
                                        // modifiedDeliverables?: boolean

// src/core/reducer.ts 桶导出追加
taskFactAdd(db, input: TaskFactAddInput): TaskFactResult
```

## Projector 扩展点（修改 project()）

1. **review satisfied 按 purpose**：`isReviewSatisfied(node)` = 存在 review
   link（purpose 匹配被审核 kind）且 review attempt outcome=passed。
2. **execute-1 gate**：入边 = review-plan-1（feasibility）satisfied；
   blocked 时 next = `tc review start <id> --node review-plan-1 --purpose
   feasibility --reviewed-attempt <plan-attempt>`。
3. **integrate on-demand**：integrate-1 satisfied 后，若其 result 的
   `modifiedDeliverables=true` → review-integrate-1 runnable（next 指向
   integration review start）；否则 record-1 runnable。
4. **reviewed-attempt 默认解析**：reviewStart 的 reviewedAttemptId 缺省时
   按 purpose 取当前 revision 对应 kind（feasibility→plan / delivery→
   execute / integration→integrate）最新 finished/success attempt。

## taskFactAdd 事务

withTransaction 内：checkRevision → 校验（attempt 归属/category/subject/
value 对象/evidence 引用/supersedes 引用）→ insert task_facts →
event `task.fact.added`（task_seq 连续）。失败零写入。

## Fixtures（development/contracts/fixtures/，load-fixture 增 taskFacts 段）

| fixture | 场景 | 验证点 |
| --- | --- | --- |
| l3-pass | 完整 L3 事实到 done | done；全节点 satisfied |
| l3-feasibility-blocked | plan 未过 feasibility | execute blocked；next 指向 feasibility start |
| l3-fact-probe | probe fact + evidence | fact 可查询、append-only |
| l3-fact-expired | supersedes 链 | 旧 fact 可引用、新 fact 生效 |
| l3-waiting-decision | needs_decision blocker | waiting 投影 + remediation |
| l3-two-children | 两分支一个未满足 | integrate blocked；全满足 runnable |
| l3-conflict | CAS 冲突场景 | TC_REVISION_CONFLICT |
| l3-stale | observation stale + task active | 两者并存正确投影 |

## Tests

- feasibility gate：未过 blocked + next 正确；过后 execute runnable；新 plan
  attempt 后重新 gate。
- fact：append-only、引用校验、坏 value 零写入、supersedes。
- integration 门：两分支、on-demand modifiedDeliverables。
- waiting(needs_decision)：projector 输出 waitingReason + remediation。
- 旧事实可引用（revision 切换后）。
