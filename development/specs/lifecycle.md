# 任务分级与动态生命周期

## 1. 分级与生命周期

Level 定义最低治理强度与证据预算，任务级节点图定义执行顺序。Agent 根据结构化任务事实判断 Level；Taskcraft 将判定结果和项目 policy 编译为当前任务的 lifecycle revision。revision 中的 required obligations 是该 revision 的执行合同。

## 2. 判级规则

判级输入采用结构化事实：`riskFlags`、`affectedContracts`、`sideEffects`、`writeScope`、`validationPlan`、`parallelism` 与 `uncertainties`。Agent 依据这些事实给出 Level 和理由，Taskcraft 保存输入与判定结果。

### L1 Quick

Agent 将以下事实同时成立的任务判为 L1：

- 目标和验收清晰。
- 修改局部、可逆、无外部不可逆副作用。
- 不改变 API、schema、权限、安全、数据完整性或架构边界。
- 单 Agent 可完成，无共享写入协调。
- 最小自动验证可立即运行。

### L3 Initiative

出现以下任一事实时，Agent 将任务判为 L3：

- 改变跨模块/API/schema/迁移/权限/安全/数据完整性边界。
- 需要多个子任务或多个 Agent 的依赖与集成。
- 产品方向或验收需访谈、研究或决策。
- 有不可逆外部动作或高影响发布。
- 需要阶段级集成验收。

### L2 Tracked

其余任务进入 L2。Agent 可以 promote；降级通过新 revision 记录原因、差异和新的 required obligations。

任务卡建立后，当前 revision 的 required obligations 是执行合同。Agent 可以在事实变化时 promote 或创建新 revision；合同变更必须留存 reason、old/new diff 和 actor。

## 3. 节点模型

每个 lifecycle node definition 包含：

```text
id, kind, title
objective, procedureRef, scope
inputSchema, outputSchema
actorConstraint
obligationDefinitions[]
entryGate, exitGate
retryPolicy
dependencyEdges[]
```

节点表达工作与证据合同。Attempt 记录 actor、运行状态和结果；projector 根据 definition 与 runtime facts 推导节点状态。

### 核心节点

| Node | 何时出现 | 主要输出 |
| --- | --- | --- |
| `frame` | L2/L3 或目标不清 | 目标、范围、验收、非目标 |
| `plan` | L3 或需要拆分/依赖 | 子任务图、依赖、执行约束、集成边界 |
| `execute` | 所有任务 | 工作成果、验证证据、变更摘要 |
| `review` | L2/L3 必做，L1 可选；可审核 plan、execute 或 integrate attempt | pass 或 findings、`reviewed_attempt_id`、review purpose、能力状态 |
| `integrate` | 多交付分支或跨模块结果需要统一验收 | 集成证据与整体验收；manual-attach 接收 plan 的子任务清单与依赖声明 |
| `record` | 所有任务 | 最终结果、残余风险、关闭记录 |

后续 typed node registry 可加入 `research`、`user-input`、`migration-check`、`security-review` 和 `release-check`。

## 4. 义务分级

| Duty | 语义 | 能否阻塞节点完成 | 能否跳过 |
| --- | --- | --- | --- |
| `required` | 完成语义的一部分 | 是 | 否 |
| `recommended` | 默认应做 | 否；项目 policy 可在编译时升级为 required | 可以，按需记录跳过原因 |
| `optional` | 增强质量或效率 | 否 | 可以，按需记录结果 |

未产生 result 的义务投影为 `pending`；持久结果为 `satisfied` 或 `skipped`。`required` 只能写入带有效 evidence 的 `satisfied`，recommended 与 optional 可直接跳过。

## 5. Level 最低合同

### L1

```text
execute [required]
  - requested outcome produced
  - minimum validation recorded
record [required]
  - result and changed scope retained
independent review [optional]
```

L1 的 `minimum validation recorded` 覆盖最小自检义务。

### L2

```text
frame [required]
execute [required]
review [required, separate attempt]
  - reviewed_attempt_id retained
  - review capability state retained
record [required]
focused plan [recommended when uncertainty exists]
research [optional]
```

### L3

```text
frame [required]
plan [required, main Agent]
feasibility review [required, separate Agent, reviews plan attempt]
  - user intent coverage retained
  - blocking feasibility assumptions probed
  - decomposition and integration path accepted
execute [required per child]
delivery review [required per execute, separate attempt]
  - reviewed_attempt_id retained
  - review capability state retained
integrate [required when graph has multiple delivery branches]
record [required]
research/security/migration/release checks [recommended or required by policy]
```

## 6. 图编译

```mermaid
flowchart LR
    F[Task facts] --> C[Agent level judgment]
    C --> L[Current revision obligations]
    P[Project policies] --> X[Lifecycle compiler]
    L --> X
    X --> V[Task lifecycle revision]
    V --> R[Single graph interpreter]
    R --> Q[Runnable nodes]
    R --> B[Blockers]
    R --> N[Next action]
```

编译结果写入 Task Store。Agent 判断局部 finding 时，在同一 revision 创建新的 execute attempt；Agent 判断需要重新规划时，reducer 校验输入结构、CAS、必填 reason 和引用关系后创建新 revision。Agent 负责 scope/contract 语义判断，reducer 负责结构与事务完整性。

首版 lifecycle revision 单线递增、只增不改。每个 revision 记录 compiler version、facts digest、policy digest、typed reason 和 old/new diff。跨 revision 保持相同语义的节点复用稳定 node id，新语义使用新 id；稳定 node id 表达 lineage。

revision 切换事务将旧 revision 中 `created` 或 `running` 的 attempt 标记为 `superseded`。旧 revision 的节点停止接受新 attempt，历史 attempt 与 evidence 保留；新 revision 通过稳定 node id 和显式 evidence 引用使用历史事实。

## 7. Agent 连续执行合同

本节是节点执行卡、连续推进、Entry Hook 与 Stop Hook 协作方式的唯一规则源。

### 7.1 节点执行卡

节点执行卡（Node Brief）是当前 lifecycle definition 与 runtime facts 的只读投影。Agent 每次领取节点 attempt 时获得一张节点执行卡，其中必须包含：

- Task、task revision、lifecycle revision、node id 与 node kind。
- 当前节点的目标、适用 procedure 和期望输出。
- 已满足的输入、可读取证据、执行范围和依赖。
- `required`、`recommended`、`optional` obligations 及其当前结果。
- 允许提交的 typed outcomes、验收条件与结果登记命令。

Projector 使用节点 definition、当前任务 facts、已有 attempt/evidence 和 procedure registry 生成节点执行卡。Procedure registry 为 `frame`、`plan`、`execute`、`review`、`integrate` 与 `record` 提供通用执行方法；当前节点 definition 的 `objective`、`procedureRef`、`scope`、输入输出合同与 obligations 提供任务特定内容。Lifecycle compiler 只 materialize 能解析 `procedureRef` 的 typed node。

Breadcrumb 保持为紧凑定位投影，携带当前 Task、lifecycle revision、节点、状态和下一条查询命令。节点执行卡承载 Agent 完成当前节点所需的执行内容。

### 7.2 连续推进

```mermaid
flowchart TD
    E[Entry Hook injects breadcrumb] --> Q[Agent queries runnable node]
    Q --> C[Agent claims attempt and receives Node Brief]
    C --> X[Agent executes with native capabilities]
    X --> S[Agent submits outcome and evidence]
    S --> V{Reducer validates contract}
    V -- missing required facts --> M[Command returns missing obligations]
    M --> X
    V -- accepted and active --> Q
    V -- waiting --> W[Agent requests input or reports blocker]
    V -- done/cancelled --> T[Agent stops]
```

每个成功的事实写命令必须返回提交后的 task status、waiting reason、完成节点和唯一 next。Task 为 `active` 且存在 runnable/running node 时，Agent 必须立即执行 next，持续完成“领取节点执行卡、执行、提交结果”的循环。

Agent 在以下投影条件下结束当前连续运行：

- `done`：当前 revision 的 required obligations 与 record 已满足。
- `cancelled`：任务存在显式取消事实。
- `waiting`：用户输入、授权、外部依赖或失败重试决策尚未满足。
- 宿主返回明确的资源或能力限制；Agent 将限制登记为 observation 或 typed blocker。

### 7.3 Hook 协作

Entry Hook 在任务首次进入、会话恢复或上下文重建时注入 breadcrumb。节点之间的正常推进由 CLI command result 中的 next 完成。

Stop Hook 在 Agent 准备结束当前运行时读取最新 breadcrumb：

- `active` 且存在 runnable/running node：返回当前节点和 next；`enforced` 模式阻止结束并恢复连续循环。
- `waiting`、`done` 或 `cancelled`：允许当前运行结束。

Host Adapter 必须通过 `continuationMode` 披露 `enforced` 或 `advisory`。`enforced` 表示宿主支持停止拦截；`advisory` 表示 Adapter 提供继续提示和恢复 breadcrumb。`tc agent capabilities`、Watch Runtime 与 diagnostics 展示该能力。

## 8. 状态与闭环

### Task status

```text
queued | active | waiting | done | cancelled
```

- `queued`：任务已登记，尚未激活。
- `active`：至少一个节点 running 或存在可运行节点。
- `waiting`：没有可运行节点，且存在 typed blocker。`waiting_reason` 取 `needs_input`、`needs_decision`、`failed_retries_exhausted` 或 `blocked_dependency`。
- `done`：所有 required 义务满足，record 已完成。
- `cancelled`：用户或策略显式终止，保留原因。

### Node status

```text
pending | running | waiting | satisfied | skipped
```

### Review outcome

```text
passed | passed_with_fix | changes_requested | replan_required
```

Review outcome 归属于 attempt；projector 根据当前 revision 的全部事实独立推导 task status。

Attempt 失败记录 retryable 或 terminal outcome；宿主 stale 保留在 observation。重试预算耗尽时，reducer 写入 `failed_retries_exhausted` blocker，projector 输出 `waiting`；下一步由 Agent 选择 retry、replan 或 cancel。

```mermaid
stateDiagram-v2
    [*] --> queued
    queued --> active: task activates
    active --> waiting: unresolved blocker/input
    waiting --> active: blocker resolved
    active --> done: required obligations + record satisfied
    queued --> cancelled: cancel
    active --> cancelled: cancel
    waiting --> cancelled: cancel
```

## 9. Review 回流

本节是 Review purpose、被审核 attempt、finding 回流与 L3 Feasibility Review 的唯一规则源。

### 9.1 L3 Feasibility Review

L3 在 Plan 与 Execute 之间生成 required Feasibility Review。主 Agent 负责 Frame 与 Plan；Feasibility Reviewer 使用独立 Agent instance 审核 Plan attempt；Execute Reviewer 使用另一个独立 Agent instance。三个执行者使用不同 `actor_instance_id`。Adapter 保存 `context-only`、`manual-attach` 或 `host-observed` 能力；界面显示 `observed-distinct`、`unverified`、`same-actor` 或 `unsupported`。`same-actor` 不满足 L3 Feasibility Review 和 Delivery Review 的 actor constraint。

```mermaid
flowchart LR
    F[Frame by main Agent] --> P1[Plan attempt 1 by main Agent]
    P1 --> R1[Feasibility Review attempt 1]
    R1 -- advisory facts + passed --> E[Execute]
    R1 -- material changes requested --> P2[Plan attempt 2]
    P2 --> R2[Feasibility Review attempt 2]
    R2 -- passed --> E
    R1 -- user decision required --> W[Waiting]
```

Feasibility Reviewer 的 required obligations 固定为：

- 建立“用户意图 -> Plan 子任务 -> 验收动作”的覆盖关系。
- 探测会改变方案、任务拆分或验收的外部 API、SDK、CLI、权限、环境与依赖假设。
- 检查子任务边界、依赖顺序、写入冲突、验证责任和最终集成路径。
- 将探测结果追加为 Task fact 与 evidence，并标明来源、时间和结论。

安全、只读、低成本的探测由 Feasibility Reviewer 直接执行。需要副作用、付费、高风险权限或用户凭据的探测创建 `waiting(needs_decision|needs_input)`。

Feasibility Review 在以下条件同时成立时通过：

- 每项用户意图都有对应子任务或验收动作。
- 没有已知的阻断性可行性问题。
- 子任务、关键依赖、验证责任和集成路径可以执行。

局部实现方式、低影响未知项和优化建议记录为 advisory finding，不阻止通过。`changes_requested` 只用于未覆盖用户意图、阻断性假设、不可执行的拆分/依赖或缺失的验证/集成路径。

Feasibility Reviewer 可以追加 `intent`、`probe`、`constraint`、`assumption`、`dependency` 与 `environment` Task facts 及其 evidence。主 Agent 负责修改目标、范围、验收和 Plan attempt。初次 Review 后默认进行一次集中 Plan 修订；第二次仍存在 blocking finding 时，主 Agent 必须选择再次修订、记录并接受风险，或进入 `waiting(needs_decision)`。

所有 Execute 节点都依赖当前 Plan attempt 的 Feasibility Review `passed` outcome。Projector 在该 gate 满足前不投影 Execute 为 runnable。

### 9.2 Delivery Review 与回流

```mermaid
flowchart LR
    E1[Execute attempt 1] --> R1[Review attempt 1]
    R1 -- passed --> Z[Record / Integrate]
    R1 -- R1 direct fix --> F1[passed_with_fix]
    F1 --> Z
    R1 -- R2 implementation finding --> E2[Execute attempt 2]
    R1 -- R3 contract change --> P2[Plan revision]
    P2 --> E2
    E2 --> R2[Review attempt 2]
    R2 -- passed --> Z
```

Delivery Review 使用以下三级回流：

- `R1 direct_fix`：Reviewer 对局部、确定、可逆、低风险且完全位于当前 scope 的问题执行最小修复。Review 记录 `passed_with_fix`、变更摘要、diff/evidence、验证结果和 `reviewerFixed=true`。一次直接修复后仍未通过的 finding 升级为 R2。
- `R2 execute_successor`：目标、范围、接口、Schema 与验收保持不变，finding 需要实质实现工作。Reducer 在当前 revision 创建 focused Execute successor attempt；下一次 Review 聚焦 successor 变更和受影响范围。
- `R3 replan`：finding 改变目标、范围、接口、Schema、验收或 lifecycle graph。Reducer 创建新 lifecycle revision；L3 新 Plan 必须再次通过 Feasibility Review。

共同约束：

- Review 使用独立节点和独立 attempt，并记录 `reviewed_attempt_id` 与 `reviewPurpose`。`feasibility` 审核 plan attempt，`delivery` 审核 execute attempt，`integration` 审核 integrate attempt。Adapter 声明 `context-only`、`manual-attach` 或 `host-observed` 能力；UI 始终展示 `observed-distinct`、`unverified`、`same-actor` 或 `unsupported` 独立性状态。
- finding 归属原 Task，不创建另一种 Review Task。
- R2 与 R3 产生新 attempt 或 revision；R1 将修复事实归属于 Review attempt。所有路径保留旧产物和证据。
- `changes_requested` 在当前 revision 为被审核 node kind 创建 successor attempt；`replan_required` 在 scope、contract 或 lifecycle graph 改变时创建 lifecycle revision。
- Integrate 只执行组合验证时可以进入 Record；Integrate 修改代码、配置或冲突结果时必须生成 `integration` Review。

## 10. Agent 编排与并行

执行主体与工具边界遵循 [架构与唯一真相源](architecture.md#2-逻辑架构)。Taskcraft projector 返回可运行节点和依赖事实；reducer 负责 CAS、引用、节点归属和结果合同校验。完整首版允许 Agent 使用宿主原生 subagent 能力，并通过 manual-attach 关联可观察的运行标识。

Agent 仅在写入范围不冲突、共享验证 owner 明确、依赖已满足且并行收益明确时并行执行。Reducer 在依赖、CAS 或节点归属冲突时写入 typed blocker，并返回稳定 remediation。

## 11. 图安全约束

- 每个 revision 至少一个终点 `record`。
- 禁止没有 Review/用户输入等可观察条件的无界循环。
- 节点数和边数由实现版本设定可解释上限，并在超限时返回稳定错误。
- required obligation 必须可追溯到某个节点输出或 evidence evaluator。
- lifecycle revision 只增不改；旧节点与其 attempt/evidence 保持可追溯，当前视图的隐藏不会物理删除历史事实。
- 后续动态插件的扩展边界是 typed node、gate 与 obligation；Task 顶层状态固定为五种。
