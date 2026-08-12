# L3 CLI 闭环样本（可回放）

> L3 纵切（`task new --level 3` → frame → plan → feasibility review →
> execute → delivery review → integrate → 按需 integration review → record
> → done）的真实命令序列 + 每步关键输出断言。样本基于 `dist/cli.js` 在
> 临时目录真实执行通过后固化（2026-08-12），覆盖 feasibility passed 主
> 路径与 feasibility changes 回流路径。回放方式：任意空目录执行
> `node dist/cli.js init` 后逐条复制命令，或按断言核对输出。所有
> `--result` / `--value` / `--evidence` 均可改用 `@path` 文件或 `@-` stdin
> 传入。revision 号按 task 全局递增；attempt id 按
> `att-<task>-<node>-<n>` 命名，n 按节点全局递增。

## 路径 1：主路径（feasibility passed → done，含 on-demand integration review）

```bash
node dist/cli.js init
#   Directory: .taskcraft / Database: .taskcraft/taskcraft.db

node dist/cli.js task new --title "Migrate auth contract" --level 3 \
  --reason "Schema migration and integration acceptance"
#   Task: T-1 / Revision: 1 / Status: queued / Next: tc run T-1 --node frame-1

node dist/cli.js run T-1 --node frame-1
#   Attempt: att-T-1-frame-1-1 / Next: tc run complete T-1 --node frame-1

node dist/cli.js run complete T-1 --node frame-1 \
  --result '{"objective":"Migrate the auth contract","scope":{"modules":["core"]},"acceptance":["Auth contract migrated"]}'
#   Revision: 3 / Next: tc run T-1 --node plan-1

node dist/cli.js run T-1 --node plan-1
#   Attempt: att-T-1-plan-1-1 / Next: tc run complete T-1 --node plan-1

node dist/cli.js run complete T-1 --node plan-1 \
  --result '{"objectiveCoverage":["Objective covered by children A and B"],"children":[{"id":"A","title":"Child A"},{"id":"B","title":"Child B"}],"dependencies":[{"name":"api-availability"}],"validationOwners":[{"childId":"A","owner":"reviewer"}],"integrationPath":"integrate://deliverables"}'
#   Revision: 5 / Next: tc review start T-1 --node review-plan-1 --purpose feasibility --reviewed-attempt att-T-1-plan-1-1

# Feasibility gate 生效：plan 完成但 review 未过时，execute 不可提前 run
node dist/cli.js run T-1 --node execute-1
#   退出码 1；stderr：TC_ATTEMPT_REF_INVALID: Node execute-1 is not runnable
#   yet: its predecessors are not satisfied + impact + remediation

node dist/cli.js review start T-1 --node review-plan-1 --purpose feasibility \
  --reviewed-attempt att-T-1-plan-1-1 --host claude
#   Revision: 6 / Review attempt: att-T-1-review-plan-1-1
#   Reviewed attempt: att-T-1-plan-1-1 / Purpose: feasibility
#   Next: tc review pass T-1 --attempt att-T-1-review-plan-1-1 --reviewed-attempt att-T-1-plan-1-1

# Review 期间发现的 probe 事实（append-only；value 可为 @path / @- / 裸 JSON）
printf '{"status":"reachable","latencyMs":42}' > api-probe.json
node dist/cli.js task fact add T-1 --attempt att-T-1-review-plan-1-1 \
  --category probe --subject "Auth API" --value @api-probe.json
#   Revision: 7 / Next: tc review pass ...（同上一行）

node dist/cli.js review pass T-1 --attempt att-T-1-review-plan-1-1 \
  --reviewed-attempt att-T-1-plan-1-1 \
  --evidence '[{"type":"validation","reference":"ref://plan-review","summary":"Feasibility verified"}]'
#   Revision: 8 / Outcome: passed / Next: tc run T-1 --node execute-1

node dist/cli.js task next T-1 --json
#   next: "tc run T-1 --node execute-1"；execute-1 状态 runnable（gate 已开）

node dist/cli.js run T-1 --node execute-1
#   Attempt: att-T-1-execute-1-1 / Next: tc run complete T-1

node dist/cli.js run complete T-1 \
  --result '{"summary":"Both children delivered","evidence":[{"type":"validation","reference":"ref://validation","summary":"Validated"},{"type":"test","reference":"ref://test","summary":"Tests pass"}]}'
#   Revision: 10 / Next: tc review start T-1 --node review-execute-1 --purpose delivery --reviewed-attempt att-T-1-execute-1-1

node dist/cli.js review start T-1 --node review-execute-1 --purpose delivery \
  --reviewed-attempt att-T-1-execute-1-1 --host claude
#   Revision: 11 / Review attempt: att-T-1-review-execute-1-1 / Purpose: delivery

node dist/cli.js review pass T-1 --attempt att-T-1-review-execute-1-1 \
  --reviewed-attempt att-T-1-execute-1-1 \
  --evidence '[{"type":"validation","reference":"ref://delivery-review","summary":"Delivery verified"}]'
#   Revision: 12 / Outcome: passed / Next: tc run T-1 --node integrate-1

node dist/cli.js run T-1 --node integrate-1
#   Attempt: att-T-1-integrate-1-1 / Next: tc run complete T-1 --node integrate-1

# modifiedDeliverables: true → on-demand integration review 投影 runnable
node dist/cli.js run complete T-1 --node integrate-1 \
  --result '{"childrenResults":[{"childId":"A","status":"passed"},{"childId":"B","status":"passed"}],"integrationEvidence":[{"type":"test","reference":"ref://integration","summary":"Integration passes"}],"modifiedDeliverables":true}'
#   Revision: 14 / Next: tc review start T-1 --node review-integrate-1 --purpose integration --reviewed-attempt att-T-1-integrate-1-1

node dist/cli.js review start T-1 --node review-integrate-1 --purpose integration \
  --reviewed-attempt att-T-1-integrate-1-1 --host claude
#   Revision: 15 / Review attempt: att-T-1-review-integrate-1-1 / Purpose: integration

node dist/cli.js review pass T-1 --attempt att-T-1-review-integrate-1-1 \
  --reviewed-attempt att-T-1-integrate-1-1 \
  --evidence '[{"type":"validation","reference":"ref://integration-review","summary":"Integration reviewed"}]'
#   Revision: 16 / Outcome: passed / Next: tc run T-1 --node record-1

node dist/cli.js run T-1 --node record-1
#   Attempt: att-T-1-record-1-1 / Next: tc run complete T-1 --node record-1

node dist/cli.js run complete T-1 --node record-1 --result '{"summary":"Recorded"}'
#   Revision: 18 / Status: done

# probe 事实闭环后可查（append-only，不因任务 done 而消失）
node dist/cli.js task show T-1 --json
#   status: "done"；facts[0]: {id:"fact-T-1-1", category:"probe",
#   subject:"Auth API", value:{status:"reachable",latencyMs:42},
#   sourceAttemptId:"att-T-1-review-plan-1-1"}
```

integrate 未修改交付物（result 省略 `modifiedDeliverables`）时，integration
review 被跳过、next 直指 record-1（`tc task next T-1` 显示
`review-integrate-1 blocked`、`record-1 runnable`），任务随后照常 record →
done，attempts 共 7 条（无 review-integrate attempt）。

## 路径 2：feasibility changes 回流（plan successor → 重新 feasibility → 通过后 gate 开）

```bash
# 前置：init → task new --level 3 → frame → plan → feasibility review start
#（同路径 1 的 revision 1-6）

node dist/cli.js review changes T-1 --attempt att-T-1-review-plan-1-1 \
  --finding "Plan misses boundary coverage"
#   Revision: 7 / Outcome: changes_requested
#   Finding: fnd-T-1-1: Plan misses boundary coverage
#   Successor attempt: att-T-1-plan-1-2 / Next: tc run complete T-1 --node plan-1

# 回流期间 execute 仍被 gate 拒绝（exit 1 / TC_ATTEMPT_REF_INVALID）
node dist/cli.js run T-1 --node execute-1

node dist/cli.js run complete T-1 --node plan-1 \
  --result '{"objectiveCoverage":["Objective covered by children A and B","Boundary coverage added"],"children":[{"id":"A","title":"Child A"}],"dependencies":[],"validationOwners":[{"childId":"A","owner":"reviewer"}],"integrationPath":"integrate://deliverables"}'
#   Revision: 8 / Next: tc review start T-1 --node review-plan-1 --purpose feasibility --reviewed-attempt att-T-1-plan-1-2

node dist/cli.js review start T-1 --node review-plan-1 --purpose feasibility \
  --reviewed-attempt att-T-1-plan-1-2 --host claude
#   Revision: 9 / Review attempt: att-T-1-review-plan-1-2（编号按节点递增）
#   Reviewed attempt: att-T-1-plan-1-2

node dist/cli.js review pass T-1 --attempt att-T-1-review-plan-1-2 \
  --reviewed-attempt att-T-1-plan-1-2 \
  --evidence '[{"type":"validation","reference":"ref://plan-review-2","summary":"Boundary coverage verified"}]'
#   Revision: 10 / Outcome: passed / Next: tc run T-1 --node execute-1

node dist/cli.js task next T-1
#   execute-1 runnable（gate 打开）；review-plan-1 satisfied

node dist/cli.js task show T-1 --json
#   历史可查询：plan-1 两条 attempt 均 finished/success（att-T-1-plan-1-1
#   与 att-T-1-plan-1-2）；findings 含 fnd-T-1-1（blocking,
#   "Plan misses boundary coverage"）；review-plan-1 两条 attempt：
#   att-T-1-review-plan-1-1 finished/changes_requested、
#   att-T-1-review-plan-1-2 finished/passed
```

## 失败契约（三件套）

```bash
node dist/cli.js task fact add T-1 --attempt att-T-1-review-plan-1-1 \
  --category gossip --subject x --value '{}'
#   退出码 1；stderr：TC_FACT_INPUT_INVALID（--category 枚举预校验）+ impact + remediation

node dist/cli.js task fact add T-1 --attempt att-T-1-review-plan-1-1 \
  --category probe --subject x --value '{not json'
#   退出码 1；stderr：TC_FACT_INPUT_INVALID（--value 非法 JSON）

node dist/cli.js task fact add T-1 --attempt att-T-1-review-plan-1-1 \
  --category probe --subject x --value '{}' --evidence ev-other-task-1
#   退出码 1；stderr：TC_EVIDENCE_REF_INVALID（evidence 不属于本 task）
```
