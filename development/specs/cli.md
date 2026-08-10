# CLI 规范

## 1. 命令设计原则

- 根命令无参数直接显示当前任务、当前 revision 与唯一下一步。
- 日常命令面聚焦 task、run、review、status 与 evidence。
- 所有任务事实写命令支持 `--expected-revision`，缺省值来自 `tc status --json` 或 breadcrumb；所有命令支持 `--json`。
- 失败必须非零退出，并给稳定 code、影响和一条 remediation。
- `--dry-run` 返回将发生的状态变化，Task Store 保持不变。
- 每条写命令都遵循 command transition contract：明确前置事实、原子写集合、成功后的唯一 next 和稳定错误 remediation。
- 每条成功的事实写命令返回提交后的状态与唯一 next；Agent 按 [连续执行合同](lifecycle.md#7-agent-连续执行合同) 继续运行。

本文使用暂定命令名 `tc`。

## 2. 一级命令

```text
tc init
tc enable <off|ask|always>
tc status
tc task [...]
tc run [...]
tc review [...]
tc watch
tc state
tc lifecycle [...]
tc agent [...]
tc doctor
tc explain <error-code>
```

`lifecycle` 与 `explain` 在帮助中归为 advanced；`task next`、`run`、`review` 和 `status` 是 Agent 的默认价值路径。

## 3. 初始化与接管

```bash
tc init --agent codex
tc init --agent claude
tc enable ask
tc status --json
tc agent capabilities
tc agent test-hook
```

`init` 已存在时只做幂等检查，不覆盖用户 entry 内容。`enable off` 必须让 hook
零输出。`agent capabilities` 输出当前宿主名、版本和各项能力是否可用；
`agent test-hook` 现场测试 Entry/Stop Hook，并返回测试时间和失败原因。研究报告中的
`verified|documented|limited|pending|deferred` 不进入生产数据模型。

## 4. Task

```bash
tc task new --title "Fix parser" --level 1|2|3 --reason "<judgment>" [--facts <json|@path|@->]
tc task list [--status active,waiting] [--json]
tc task next <task-id> [--json]
tc task show T-104 [--json]
tc task promote T-104 --to 3 --reason "API migration"
tc task revise T-104 --level 2 --reason "Risk condition removed"
tc task wait T-104 --reason needs_input --message "Need schema decision"
tc task resume T-104
tc task cancel T-104 --reason "superseded"
tc task evidence add T-104 --attempt att_execute_1 --type test --ref report.json
tc task fact add T-104 --attempt <id> --category probe --subject "API capability" --value <json|@path> --evidence <id>
tc task export T-104 --format md
```

Agent 提交任务目标、Level 和判定理由；其他 facts 按需提供，缺失就是未提供。
`task new` 生成当前 revision 的 required obligations，但不激活任务或创建 attempt。
`promote` 提供升级快捷路径；`revise` 通过新 revision 修改 Level 或合同并留存原因
与差异。根命令 `tc` 只在恰有一个 active task 时提供无 task id 的快捷 next；
`task next` 始终使用显式 task id。

## 5. Run 与 Review

```bash
tc run T-104
tc run T-104 --node execute-1 --host codex
tc run status T-104
tc run attach T-104 --node execute-1 --host-run-id <id>
tc run retry T-104 --attempt <id> --reason stale

tc review start T-104 --node review-1 --purpose feasibility|delivery|integration --reviewed-attempt <attempt-id> --host claude
tc review pass T-104 --attempt <id> --reviewed-attempt <attempt-id> --evidence ev_12
tc review changes T-104 --attempt <id> --finding "Missing boundary test"
tc review replan T-104 --attempt <id> --finding "Contract changed"
```

`tc task next` 返回 runnable node 摘要和领取命令。对 queued Task，第一次 `tc run`
在同一 reducer 事务中写激活事实并创建或领取首个 attempt；已激活任务的后续
`run` 只处理目标 node attempt。命令输出 Node Brief，但不启动 Agent 或
subagent。当前 Agent 使用自身能力执行，也可以按 Node Brief 的派发说明调用宿主
原生 subagent；`run attach` 只登记已有 host run 的观察关系。

`review start` 记录 `reviewPurpose`：`feasibility` 审核 plan attempt，`delivery`
审核 execute attempt，`integration` 审核 integrate attempt，并保存 Review correlation
能力（`context-only`、`manual-attach`、`host-observed`）与独立性状态。
`review pass` 检查 required evidence；Reviewer 修改过内容时先用现有 evidence
命令记录 diff 和验证，outcome 仍为 `passed`。`review changes` 在当前 revision
为被审核 node kind 创建 successor attempt；`review replan` 创建新的 lifecycle
revision。三个命令都由 reducer 校验结构、CAS、结果 Schema 和引用关系。

## 6. Watch 与状态

```bash
tc watch
tc watch --task T-104
tc watch --port 0
tc state --breadcrumb
tc state --json
tc lifecycle inspect T-104
tc lifecycle explain T-104 --node review-1
tc lifecycle validate T-104
```

`watch` 默认绑定 `127.0.0.1` 随机端口并打开浏览器；`--no-open` 只打印 URL。深链在同一 Watch 会话内稳定；无浏览器环境可使用 `tc task list` 与 `tc task show`，两者读取同一 Task Store。

## 7. 常见闭环

### L1

```bash
tc task new --title "Fix typo" --level 1 --reason "Local reversible text change"
# task new 只建卡；run 激活任务并领取 execute attempt：
tc run T-201 --node execute-1
# Agent 完成工作与验证后：
tc run complete T-201 --result result.json --expected-revision 2
```

L1 从建卡到完成依次使用 `task new`、`run` 与 `run complete`。`run complete` 可以
在同一事务满足 execute 与 record，但不能代替首次 `run` 的激活事实。

### L2

```bash
tc task new --title "Add retry policy" --level 2 --reason "Shared adapter behavior needs separate review"
tc run T-202 --node frame-1
tc run complete T-202 --node frame-1 --result frame.json
tc run T-202 --node execute-1
tc run complete T-202 --node execute-1 --result result.json
tc review start T-202 --node review-1 --purpose delivery --reviewed-attempt att_execute_1 --host claude
tc review pass T-202 --attempt att_review_1 --reviewed-attempt att_execute_1 --evidence ev_review
tc run T-202 --node record-1
tc run complete T-202 --node record-1 --result record.json
```

### L3

```bash
tc task new --title "Migrate auth contract" --level 3 --reason "Schema migration and integration acceptance"
tc run T-203 --node frame-1
tc run complete T-203 --node frame-1 --result frame.json
tc run T-203 --node plan-1
tc run complete T-203 --node plan-1 --result plan.json
# Feasibility Review 检查用户意图覆盖；独立 reviewer 可用时优先使用
tc review start T-203 --node review-plan-1 --purpose feasibility --reviewed-attempt att_plan_1 --host claude
tc task fact add T-203 --attempt att_review_plan_1 --category probe --subject "Auth API" --value @api-probe.json --evidence ev_api_probe
tc review pass T-203 --attempt att_review_plan_1 --reviewed-attempt att_plan_1 --evidence ev_plan_review
# Plan Review 通过后，当前 Agent 使用自身工具逐项执行并按需 manual-attach
tc task next T-203 --json
tc run T-203 --node execute-1
tc run complete T-203 --node execute-1 --result execute.json
tc review start T-203 --node review-execute-1 --purpose delivery --reviewed-attempt att_execute_1 --host claude
tc review pass T-203 --attempt att_review_execute_1 --reviewed-attempt att_execute_1 --evidence ev_delivery_review
tc run T-203 --node integrate-1
tc run complete T-203 --node integrate-1 --result integrate.json
tc run T-203 --node record-1
tc run complete T-203 --node record-1 --result record.json
tc lifecycle inspect T-203
```

### 7.1 Command transition table

| 命令 | 前置事实 | 原子写集合 | 成功后的唯一 next |
| --- | --- | --- | --- |
| `task new` | 仓库已初始化；Agent 提交目标、Level、reason，可选 facts | Task、初始 lifecycle revision、required obligations、审计事件；不写激活事实或 attempt | 返回 `taskId`、`taskRevision` 与唯一 `run` |
| `task promote/revise` | Task 存在；Agent 提交新 Level/合同与 reason；CAS 匹配 | 新 lifecycle revision、old/new diff、旧运行 attempt 的 `superseded` 结果、审计事件 | 返回新 revision 的首个 runnable node |
| `task wait` | Task 已激活；typed reason 与 remediation 可读；CAS 匹配 | open blocker、审计事件 | 返回 `task resume`、用户输入或指定 remediation |
| `task resume` | 对应 blocker 已具备解决事实；CAS 匹配 | blocker resolved、审计事件 | 返回当前首个 runnable node |
| `task cancel` | Task 尚未形成取消事实；CAS 匹配 | cancel fact、活跃 attempt 终止结果、审计事件 | 返回只读 `task show` |
| `task evidence add` | evidence reference 可读；目标 attempt/Task 引用有效；CAS 匹配 | evidence、可满足的 obligation result、审计事件 | 返回 projector 推导的 next |
| `task fact add` | 来源 attempt 有效；category、subject、value 与可选 evidence 可读；CAS 匹配 | append-only Task fact、审计事件 | 返回当前 Review/节点的 next |
| `run <task>` | Task 为 queued，或当前 lifecycle revision 存在 runnable node；CAS 匹配 | queued 时写激活事实；创建或领取 node attempt、actor claim、审计事件 | 返回 Node Brief 与 `run complete`；Agent 可选执行 `run attach` |
| `run attach` | attempt 已创建；Agent 提供已有 host run；CAS 匹配 | agent run observation、attempt actor binding、审计事件 | 返回 `run status`/`run complete` |
| `run retry` | 旧 attempt 已失败或 superseded，或其 host observation 为 stale；Agent 给出 reason；CAS 匹配 | successor attempt、旧 attempt 结束事实、审计事件 | 返回 successor `run`/`run attach` |
| `run complete` | attempt 属于当前 lifecycle revision；结果满足节点 gate；CAS 匹配 | attempt outcome、evidence refs、obligation results、审计事件 | 返回 projector 推导的下一节点命令 |
| `review start` | 当前 revision 的 review node runnable；review purpose 与被审核 attempt kind 匹配；CAS 匹配 | review attempt、review link、purpose、能力与独立性披露、审计事件 | 返回 Review 节点上下文、可选 attach 与结论命令 |
| `review pass` | review link 有效；required review evidence 完整；CAS 匹配 | review outcome、evidence refs、审计事件 | 返回 `record`、`integrate` 或新的 runnable node |
| `review changes` | review link 有效；finding 需要实质修改且合同保持不变；CAS 匹配 | finding、被审核 node kind 的 successor attempt、审计事件 | 返回 successor `run` |
| `review replan` | review link 有效；Agent 提交 typed reason 与新合同；CAS 匹配 | 新 lifecycle revision、old/new diff、旧运行 attempt 的 `superseded` 结果、审计事件 | 返回新 revision 的首个 runnable node |

所有写命令以当前 revision 的 CAS 校验为入口；冲突返回 `TC_REVISION_CONFLICT` 与最新 `tc status --json` 查询命令。reducer 的结构校验、引用校验和事务失败保持显式可见。

## 8. JSON 结果

Node Brief 告诉 Agent 应提交的 JSON 结构和登记命令。Taskcraft 在每次结果写入前
使用本地 Ajv 校验；校验失败返回 `TC_LIFECYCLE_RESULT_INVALID`，不写入任何
部分事实。宿主或模型支持原生 JSON Schema 时可以用来提前约束输出，但它不是
正确性的前提，也不能代替本地校验。

成功：

```json
{
  "schemaVersion": "tc-command-result/v1",
  "ok": true,
  "data": {
    "taskId": "T-104",
    "taskRevision": 12,
    "status": "active",
    "next": {"command": "tc review start T-104 --node review-1 --expected-revision 12"}
  },
  "errors": []
}
```

失败：

```json
{
  "schemaVersion": "tc-command-result/v1",
  "ok": false,
  "data": null,
  "errors": [{
    "code": "TC_REQUIRED_EVIDENCE_MISSING",
    "problem": "review-1 cannot pass without boundary-test evidence",
    "impact": "task remains active at review-1",
    "remediation": {
      "command": "tc task evidence add T-104 --attempt att_execute_2 --type test --ref <path>"
    }
  }]
}
```

## 9. Error taxonomy

| Prefix | 范围 |
| --- | --- |
| `TC_TASK_*` | Task 不存在、状态或级别问题 |
| `TC_LIFECYCLE_*` | 图、节点、依赖、义务问题 |
| `TC_REVISION_*` | 并发与 CAS |
| `TC_EVIDENCE_*` | 证据缺失或无效 |
| `TC_ADAPTER_*` | host capability、Hook、run |
| `TC_STORE_*` | SQLite、迁移、事务、完整性 |
| `TC_POLICY_*` | 项目策略拒绝 |

错误 remediation 只引用 CLI、adapter 或用户输入动作；Task Store、Board、breadcrumb 和 Watch 由同一 command service 产生。

## 10. Shell 能力

CLI 应发挥终端优势：shell completion、可组合 JSON、稳定 exit code、`--dry-run`、`--no-color`、深链 URL、从 stdin 接收结构化结果、流式 `run status --follow`。Web 负责观察，CLI 负责脚本化与 Agent 调用。
