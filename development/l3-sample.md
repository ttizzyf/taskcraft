# L3 CLI 闭环样本（`tc-l3/2`，可回放）

> 2026-08-17 使用构建后的 `dist/cli.js` 在全新临时目录回放。主路径只调用公开
> CLI：父 L3 planning → Feasibility Review → 两个真实 child → dependency →
> child waiting/resume 与 Delivery Review → 父 Integrate/Record → doctor。
> Taskcraft 不创建或停止宿主 subagent。

先在仓库根目录执行 `pnpm build`，再把 `dist/cli.js` 的绝对路径保存为 `TC`，进入
一个全新临时目录。以下 `@file.json` 都可换成等价的裸 JSON 或 `@-` stdin。

## 1. Modules 主路径

### 1.1 Frame 与 Plan 输入

`frame.json`：

```json
{
  "objective": "Migrate the auth contract",
  "scope": ["core", "cli"],
  "acceptanceAnchors": [
    {"id": "A-01", "text": "Storage closes independently"},
    {"id": "A-02", "text": "Projection waits for storage"}
  ],
  "nonGoals": ["Taskcraft does not schedule subagents"]
}
```

`plan.json`：

```json
{
  "decomposition": {
    "mode": "modules",
    "reason": "Storage and projection are independently reviewable",
    "attemptedSplits": []
  },
  "modules": [
    {
      "key": "contract",
      "title": "Auth contract storage",
      "level": 2,
      "reason": "Storage needs a delivery review",
      "objective": "Persist the auth contract",
      "scope": ["migrations", "store"],
      "acceptance": ["The auth contract is persisted"],
      "nonGoals": ["No UI"],
      "covers": ["A-01"],
      "reviewFocus": ["foreign keys"]
    },
    {
      "key": "projection",
      "title": "Auth contract projection",
      "level": 1,
      "reason": "Projection is independently testable",
      "objective": "Project the auth contract",
      "scope": ["projector"],
      "acceptance": ["The projection reads the contract"],
      "nonGoals": ["No scheduling"],
      "covers": ["A-02"],
      "reviewFocus": ["status precedence"]
    }
  ],
  "coverage": [
    {"anchorId": "A-01", "disposition": "required", "moduleKeys": ["contract"]},
    {"anchorId": "A-02", "disposition": "required", "moduleKeys": ["projection"]}
  ],
  "dependencies": [{"task": "projection", "dependsOn": "contract"}],
  "executionMode": "serial",
  "sharedValidations": [
    {"id": "full-check", "reference": "pnpm check", "owner": "parent-integrate"}
  ],
  "integrationPath": "integrate://deliverables"
}
```

### 1.2 父 planning revision 与原子物化

```bash
node "$TC" init
node "$TC" task new --title "Migrate auth contract" --level 3 \
  --reason "Schema migration and integration acceptance"
# T-1 queued；next = tc run T-1 --node frame-1

node "$TC" run T-1 --node frame-1
node "$TC" run complete T-1 --node frame-1 --result @frame.json
node "$TC" run T-1 --node plan-1
node "$TC" run complete T-1 --node plan-1 --result @plan.json

node "$TC" review start T-1 --node review-plan-1 --purpose feasibility \
  --reviewed-attempt att-T-1-plan-1-1
node "$TC" review pass T-1 --attempt att-T-1-review-plan-1-1 \
  --reviewed-attempt att-T-1-plan-1-1 \
  --evidence '[{"type":"validation","reference":"ref://plan-review","summary":"Feasibility verified"}]'
```

最后一条命令必须同时返回 `L3 mode: modules`、真实 children `T-2`/`T-3` 和
`Next: tc run T-2`。数据库中父任务进入 lifecycle revision 2；T-2 是 L2、T-3 是
L1，二者 `parentTaskId` 都是 T-1，且没有伪造的 Frame/Plan Attempt。

```bash
node "$TC" task next T-1 --json
# runnableWorkItems 只有 T-2；T-3 被显式 dependency(T-3 dependsOn T-2) 阻塞

node "$TC" task show T-1 --json
# children、anchors、coverage、dependencies、validations、executionSource 同源可见

node "$TC" task cancel T-1 --reason "must not cascade"
# 退出码 1；TC_TASK_CHILDREN_UNRESOLVED；T-2/T-3 不会被自动取消
```

### 1.3 Child waiting/resume、Review 与完成

`child-result.json`：

```json
{
  "summary": "Module delivered",
  "evidence": [
    {"type": "validation", "reference": "ref://validation", "summary": "Validated"},
    {"type": "test", "reference": "ref://test", "summary": "Tests pass"}
  ]
}
```

```bash
node "$TC" run T-2 --node execute-1
node "$TC" task wait T-2 --reason needs_input --message "Need schema decision"
node "$TC" task show T-1 --json
# parent waiting(needs_input)，next = tc task resume T-2

node "$TC" task resume T-2 --resolve
node "$TC" run T-2 --node execute-1
# waiting 关闭了 blocked attempt；这里创建 successor execute attempt 2
node "$TC" run complete T-2 --node execute-1 --result @child-result.json
node "$TC" review start T-2 --node review-1 --purpose delivery \
  --reviewed-attempt att-T-2-execute-1-2
node "$TC" review pass T-2 --attempt att-T-2-review-1-1 \
  --reviewed-attempt att-T-2-execute-1-2 \
  --evidence '[{"type":"validation","reference":"ref://child-review","summary":"Child reviewed"}]'
node "$TC" run T-2 --node record-1
node "$TC" run complete T-2 --node record-1 \
  --result '{"summary":"L2 child recorded"}'

node "$TC" task next T-1 --json
# T-2 done 后 T-3 成为 runnable

node "$TC" run T-3 --node execute-1
node "$TC" run complete T-3 --node execute-1 \
  --result '{"summary":"Projection delivered","evidence":[{"type":"validation","reference":"ref://projection","summary":"Projection validated"},{"type":"test","reference":"ref://projection-test","summary":"Projection tests pass"}],"record":{"summary":"L1 child recorded"}}'
```

### 1.4 父 Integrate 与关闭

完成上述固定序列后，T-2 的 task revision 为 10，T-3 为 3。Integrate 必须使用
真实 child revision 和属于该 child 的 evidence id；不能再提交自报的 child 状态。

```bash
node "$TC" run T-1 --node integrate-1
node "$TC" run complete T-1 --node integrate-1 \
  --result '{"childrenResults":[{"taskId":"T-2","taskRevision":10,"evidenceRefs":["ev-T-2-att-T-2-execute-1-2-1"]},{"taskId":"T-3","taskRevision":3,"evidenceRefs":["ev-T-3-att-T-3-execute-1-1-1"]}],"integrationEvidence":[],"modifiedDeliverables":false}'
node "$TC" run T-1 --node record-1
node "$TC" run complete T-1 --node record-1 --result '{"summary":"Recorded"}'
node "$TC" task show T-1 --json
# status = done；children 均为 done；next = null

node "$TC" doctor
# Doctor: 8 checks passed
```

若 Integrate 设置 `modifiedDeliverables: true`，还必须提供 integration evidence，并
在 Record 前完成 `review-integrate-1`。

## 2. Single L3

`single-plan.json` 与 modules Plan 使用相同顶层字段，但必须满足：

```json
{
  "decomposition": {
    "mode": "single",
    "reason": "The migration is one atomic cutover",
    "attemptedSplits": [
      {
        "proposal": "Separate migration and verification",
        "failureReason": "Verification is part of the same atomic cutover"
      }
    ]
  },
  "modules": [],
  "coverage": [
    {"anchorId": "A-01", "disposition": "required", "moduleKeys": []},
    {"anchorId": "A-02", "disposition": "required", "moduleKeys": []}
  ],
  "dependencies": [],
  "executionMode": "serial",
  "sharedValidations": [
    {"id": "full-check", "reference": "pnpm check", "owner": "parent-integrate"}
  ],
  "integrationPath": "integrate://single"
}
```

Feasibility pass 后不得创建 child，父 next 为 `tc run T-1 --node execute-1`。之后依次
完成父 execute、Delivery Review、Integrate、按需 Integration Review 和 Record。
缺少 attempted split、失败原因或误带 modules 时，Feasibility pass 返回
`TC_L3_PLAN_INVALID`，Review/evidence/execution revision 全部回滚。

## 3. Child 触发父 replan

继承型 L2 child 的 Delivery Review 如果发现模块合同本身错误：

```bash
node "$TC" review replan T-2 --attempt att-T-2-review-1-1 \
  --reason contract_changed --finding "Parent module boundary must change"
```

命令返回的是 root `Task: T-1` 与新 planning revision 的
`Next: tc run T-1 --node frame-1`。旧 children 在新 planning revision 记录为
`not_required`，但 Taskcraft 不取消 child、不删除 Attempt/Evidence，也不停止宿主
subagent。新 Plan 可在合同完全一致时给 module 增加 `"reuseTaskId":"T-2"`；合同
有任何变化则必须创建新 child，不能静默改写旧任务。
