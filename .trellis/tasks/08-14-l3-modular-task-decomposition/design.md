# L3 模块化父子任务方案

> 状态：Implemented and checked（2026-08-17）  
> 本文记录已实现方案；产品需求与验收标准见同目录 `prd.md`。

## 1. 执行摘要

当前 Taskcraft 的 L3 名义上有 Plan、children 和 Integrate，实际上仍是一个单体任务：Plan 最多声明一个信息性 child，运行时始终只有一个 `execute-1`，child 没有独立状态、生命周期、Review、waiting 或 evidence。

本方案将 L3 改成两阶段父任务：

1. **规划阶段**：父任务执行 `frame -> plan -> feasibility review`，形成产品验收锚点、模块方案、覆盖关系、依赖、共享验证归属和集成路径。
2. **交付阶段**：Feasibility Review 通过时，Reducer 在一个事务里物化真实 child tasks，并把父任务切换到执行 revision。每个 child 独立运行自己的 L1/L2 execution-only 生命周期；父任务等待 required children 完成后进入 `integrate -> optional integration review -> record`。

方案借用 KP 的“验收锚点、覆盖表、合并优先、软拆卡预算”，借用 Trellis 的“父任务拥有源需求与集成、child 必须独立闭环”，但不引入 KP 的多角色仪式、Board、Markdown 状态同步和密集手工命令。所有事实仍只写 SQLite，由单 Reducer 写入、单 Projector 投影。

一句话概括：

> KP 负责教 TC 怎么诚实地拆；Trellis 负责教 TC 拆出来的必须是真任务；TC 用数据库和状态机把两者变成低摩擦、可审计的运行合同。

## 1.1 2026-08-14 评审讨论吸收结论

| 决策 | 结论 | 本方案处理 |
|---|---|---|
| Scope 是软边界 | 接受 | scope 只表达主战场与协调提示；Reducer 不按 scope 拒绝写入，Review 检查实际 changed scope 与验收影响 |
| Child 不重复规划 | 接受产品意图 | module proposal 成为 child 的 inherited planning contract，child 的真实 Agent 工作从 execute 开始；继承必须有父 Plan attempt 来源，不能伪造宿主执行 |
| 永久不支持 nested L3 | 接受并冻结 | 这不是 MVP 延后项；父 L3 只物化 L1/L2 child，候选模块若仍需拆分，回父 Plan 生成同级 sibling modules |
| Replan 三层职责 | 接受 | 主 Agent 管宿主 subagent；Taskcraft 写 `not_required` membership 并更新 next；历史成果和副作用不删除 |
| 父任务取消不级联 | 接受并冻结 | 存在未完成 required child 时拒绝取消父任务；主 Agent 先停止宿主运行并逐个记录 child 处置 |
| 并行三层职责 | 接受 | 宿主 Agent 决定实际并行，Taskcraft 只返回 runnable facts，显式 dependency contract 决定硬阻塞；不增加并行预算或调度器 |
| “共享关系等于依赖” | 不接受为硬规则 | 共享 scope、验证和锚点只是 coordination signal；它们可以定义“完全无关联”，但不能自动阻止 runnable 或推导 replan 影响 |
| 保留 Single L3 | 接受并冻结 | 无法合理拆分时不制造 child；必须同期提交“尝试过的拆分及失败原因”并通过 Feasibility Review |

最后两点的原因是：TC 一旦用共享 scope/锚点推断“不能同时运行”，就在没有明确合同的情况下承担了调度判断；而开放没有审核抓手的 `single`，会让所有反过度偷懒规则失效。

## 2. 为什么现在要改

### 2.1 当前 L3 的能力描述与真实运行不一致

当前 L3 固定图是：

```text
frame
  -> plan
  -> feasibility review
  -> execute-1
  -> delivery review
  -> integrate
  -> optional integration review
  -> record
```

Plan 结果虽然包含 `children`，但：

- `children.maxItems = 1`；
- child 只有 `id` 和 `title`；
- child 不写入 `tasks`；
- 不存在 per-child lifecycle、Attempt、Review、waiting、retry 和 evidence；
- Integrate 的 `childrenResults` 只是 Agent 自报 JSON，不能引用真实 child 完成事实。

所以当前 L3 更准确的名称是“治理更严格的单体复杂任务”，不是 Initiative 或可拆分复杂任务。

### 2.2 直接在父任务里增加多个 execute 节点不是正确修复

把 Plan 的每个 module 编译成父任务内的 `execute-A`、`execute-B`，看似改动较小，但会产生几个结构问题：

- 所有模块共享父任务的 CAS revision，独立写入容易互相冲突；
- 模块无法独立 waiting、取消、重试、Review 和归档；
- 父任务生命周期会随模块数膨胀，重规划时稳定节点 lineage 很难维护；
- 模块仍不是真实 Task，CLI、Watch 和跨会话恢复只能把它们当节点；
- 未来如果使用宿主原生 subagent，不同运行仍会争抢同一 Task 的事实流。

因此，模块应物化为真实 Task，而不是把父任务扩成一个巨型动态图。

### 2.3 只增加 `parent_task_id` 也不够

数据库已经有 `tasks.parent_task_id`，但父子树只回答“谁属于谁”，不能回答：

- 哪个父 lifecycle revision 要求这个 child；
- child 覆盖哪些父级验收锚点；
- child 之间有什么真实依赖；
- 哪个 child 或父 Integrate 负责共享验证；
- 重规划后哪些旧 child 被保留、取代或不再 required。

所以要复用 `parent_task_id` 表达永久层级，同时增加 revision-scoped 的计划定义事实。

## 3. 从 KP 和 Trellis 各取什么

## 3.1 借用 KP 的部分

### 产品验收锚点

父 L3 在 Frame 阶段先写用户可观察结果和不可破坏的边界，例如：

```text
[A-01] 用户可以在 Watch 中看到父任务及所有 required children 的真实状态
[A-02] required child 未完成时，父任务不能进入 Integrate
[A-03] 重规划不会删除旧 child 的 Attempt 和 Evidence
```

锚点不是工程步骤，也不是任务卡数量提示。

### 多对多覆盖，而不是“一锚点一卡”

```text
验收锚点 A-01 ──┬──> module watch-projection
                 └──> module query-contract

验收锚点 A-02 ─────> module parent-projector
```

一个 child 可以覆盖多个锚点，一个锚点也可以由多个 child 共同覆盖。未覆盖锚点必须显式 `deferred` 或 `descope`，不能静默遗漏。

### 合并优先和软预算

- 小型 L3 建议 1–3 个模块；
- 中型 L3 建议 3–5 个模块；
- 超过 5 个必须解释为什么不能合并；
- 这是 Planner/Review 的 advisory 规则，不是数据库硬上限；
- 共享上下文、共享写入域和强串行依赖优先合并。

### 独立记录依赖与共享验证归属

父子关系不表示执行顺序。Plan 必须单独说明：

- `module-b dependsOn module-a`；
- 执行建议是 `serial | parallel | hybrid`；
- 共享 fixtures、全量 check 或集成测试由哪个 child 或父 Integrate 收口。

## 3.2 借用 Trellis 的部分

### 父任务的职责

父任务拥有：

- 原始目标和产品验收锚点；
- 模块地图与覆盖关系；
- 跨 child 的验收标准；
- 最终 Integrate 和整体关闭记录。

父任务通常不直接承担产品实现。

### child 的成立条件

只有能够在父 Plan 给出的 inherited planning contract 下独立实现、验证、Review、waiting/resume 和关闭的交付物才是 child。文件、函数、前端一步、后端一步或文档 bullet 本身都不是 child 边界。

### 任务树不是依赖图

所有 child 都属于父任务，不代表它们可以并行，也不代表先后顺序。依赖必须是显式边。

## 3.3 明确不照搬的部分

本方案不引入：

- KP 的 Strategist / Planner / Dispatcher / Implementer / Reviewer / Integrator 状态角色链；
- Board、Phase Markdown、任务卡 Markdown、Review 卡和 telemetry 的重复状态维护；
- 每个 child 都要求用户手工执行 `tc task new`；
- Taskcraft 自己创建 subagent、worktree、分支或远程 runner；
- Stop Hook 或其他强制 Agent 续跑机制。

角色可以作为 Node Brief 的建议，但不是 Task Store 中的新状态机。

## 4. 核心产品模型

## 4.1 三类对象

```text
L3 Parent Task
  ├── Acceptance Anchors
  ├── Accepted Plan Revision
  ├── Required Child Membership
  ├── Coverage / Dependencies / Validation Ownership
  └── Integration Lifecycle

Child Task
  ├── Own Level (L1/L2 only)
  ├── Own Lifecycle Revision
  ├── Own Public Status
  ├── Own Attempts / Reviews / Evidence / Blockers
  └── Permanent parent_task_id
```

### Acceptance Anchor

父任务 revision 内的稳定验收事实。相同语义跨 revision 复用 ID；语义发生实质变化时新增 ID，旧锚点在新 revision 中标为 `deferred`、`descope` 或由新的锚点取代，历史不删除。

### Module Proposal

Plan Attempt 里的候选模块，使用稳定 `moduleKey`，此时还不是 Task。只有 Feasibility Review 通过后才获得真实 `taskId`。

### Required Child Membership

某个父 lifecycle revision 对 child 的完成要求。`tasks.parent_task_id` 表达永久层级，membership 表达“当前 revision 是否仍要求它”。重规划不改写历史 membership。

## 4.2 拆分模式

Plan 必须明确一种模式：

### `modules`

- 至少两个可独立验收模块；
- Review 通过后物化真实 child tasks；
- 父任务不生成普通产品实现 execute；
- required children 全部 done 后才能 Integrate。

### `single`（已确认保留）

- 用于治理强度高但没有诚实模块边界的任务；
- 必须记录不拆分理由；
- Feasibility Review 必须审核该理由；
- 执行 revision 保留父任务自身的 execute 和 delivery review；
- 不创建形式主义的单 child 包装。

例如一次不可分割的高风险数据库切换可能是 L3，但强制拆成“执行迁移”和“验证迁移”两个 child 只是把同一原子交付物切成步骤，并没有形成独立模块。

## 5. 生命周期设计

## 5.1 为什么使用“两阶段 lifecycle revision”

当前 lifecycle definition 一旦物化即不可修改，而任务创建时还不知道 Plan 会选择 `single` 还是 `modules`。如果在同一 revision 预建两套分支，就需要引入条件节点、条件 obligation 和大量“未适用节点”规则。

更干净的方式是把 L3 分为两个连续、不可变的 revision：

### Planning revision

```text
frame -> plan -> feasibility review
```

### Accepted execution revision

`modules`：

```text
required children gate
  -> integrate
  -> optional integration review
  -> record
```

`single`：

```text
execute
  -> delivery review
  -> integrate
  -> optional integration review
  -> record
```

Feasibility Review 通过是 revision 切换点。新 execution revision 通过 `sourcePlanAttemptId` 和 `feasibilityReviewAttemptId` 引用 planning revision 的证据，因此当前完成合同不需要伪造一组已经完成的新 Plan 节点。

这保持了三个不变量：

- 每个 lifecycle revision 自身不可变；
- 当前 revision 只包含实际适用的节点与 required obligations；
- 旧 Plan、Review、Attempt 和 Evidence 永久可查询。

## 5.2 模块化 L3 的完整路径

```text
1. tc task new --level 3
2. parent frame
3. parent plan(mode=modules, module proposals, coverage, dependencies)
4. parent feasibility review
5. review pass transaction:
   - 保存 review pass
   - 校验锚点覆盖、依赖、moduleKey、Level 和共享验证 owner
   - 创建真实 child tasks 与各自 lifecycle revision 1
   - 写入 parent/child revision-scoped relations
   - 创建父 execution revision
   - 把父 current_lifecycle_revision 指向 execution revision
   - 写完整事件链
6. Agent 根据 parent `next` 推进 runnable children
7. required children 全部 done
8. parent integrate
9. 若 Integrate 修改交付物，执行 integration review
10. parent record -> done
```

步骤 5 必须是一个 SQLite 事务。任何一个 child 合同、依赖或覆盖校验失败，Review pass 和所有 child 创建都一起回滚，不能出现“Review 已通过但只创建了一半 child”。

## 5.3 Child 继承规划，真实执行从 Execute 开始

父 Plan 的 module proposal 已经包含 child 的 objective、scope、acceptance、nonGoals、Level 判断、覆盖锚点与 Review focus。要求 child 再运行 Frame/Plan 会产生重复劳动和两个可漂移的规划来源。

因此物化事务必须为 child 建立 **inherited planning contract**：

- child 的任务内容由 accepted module proposal 编译，不能在物化时静默改写；
- child 保存 `sourceParentTaskId`、`sourceParentLifecycleRevision` 和 `sourcePlanAttemptId`；
- child 的 UI/查询可以把 Frame/Plan 展示为 inherited/satisfied，但必须显示来源；
- 不创建一条假的 host Attempt 来冒充 Agent 已执行 Frame/Plan；
- child Node Brief 的第一个真实动作是 execute；L2 child 随后仍执行自己的 delivery review；
- child 如果在执行中发现目标或合同错误，通过 `replan_required` 回到父 L3 Planner，而不是在 child 内悄悄维护第二份 Plan。

技术实现有两种可评审选择：

1. **推荐：execution-only child graph**。child revision 1 只物化从 execute 开始的适用节点，relation contract 保存 inherited planning provenance；
2. **备选：inherited node satisfaction**。保留 frame/plan definitions，但新增明确的 inherited satisfaction fact，由 Projector 判为 satisfied。

不推荐向 `node_attempts` 塞入伪造的 finished host Attempt，因为 Attempt 应继续表示真实执行事实。

这个决定同时关闭 nested L3：一个 L3 child 如果从 execute 开始，就没有机会再做自己的模块拆分。父 Plan 只能物化 L1/L2 child；如果候选模块仍大到需要 L3 级拆分，Feasibility Review 必须退回父 Plan，把它继续拆成同一父任务下的 sibling modules。

## 5.3 父任务状态聚合

五个公开状态不增加新枚举，父任务仍投影为：

| 子任务/父节点事实 | 父任务投影 |
|---|---|
| 尚未激活 | `queued` |
| 至少一个 required child runnable/running，或父节点 runnable/running | `active` |
| 无 runnable/running 工作，至少一个 required child `waiting` | `waiting`，传播最优先的 typed waitingReason |
| required child 被取消或计划关系失效 | `waiting(needs_decision)`，要求 replan/明确处置 |
| required children 全部 `done`，Integrate 尚未完成 | `active`，next 指向 Integrate |
| 父 Record 和当前全部 required obligations 满足 | `done` |
| 父任务显式取消 | `cancelled` |

只要还有可推进的 sibling，某个 child waiting 不应让整个父任务提前变成 waiting；父任务继续 `active`，同时在 detail 中展示局部 blocker。

## 5.4 next 与并行

Projector 返回完整的 `runnableWorkItems`：

```json
[
  {"taskId":"T-12","parentTaskId":"T-10","command":"tc run T-12","reason":"no unmet dependency"},
  {"taskId":"T-13","parentTaskId":"T-10","command":"tc run T-13","reason":"no unmet dependency"}
]
```

- JSON/Watch 展示全部 runnable children；
- 现有字符串 `next` 保留，确定性选择第一个建议命令，避免破坏 Entry/Breadcrumb 的紧凑合同；
- 顺序由显式依赖、Plan order 和 task id 决定，不暗示 Taskcraft 已经派发；
- Agent 自己决定串行执行还是使用宿主原生 subagent。

并行相关术语必须分开，避免把协调提示偷换成调度约束：

- **unblocked**：没有未满足的显式 `dependsOn`；这是 Taskcraft 可强校验的事实；
- **runnable**：unblocked 且 child 自己的 lifecycle gate 允许执行；这是 Projector 输出；
- **coordination-free**：没有共享写入域、共享验证、共享锚点或其他协调面；这是 Plan/Review 的说明性判断；
- **parallel-safe**：宿主 Agent 综合工具、分支、运行环境和协调成本后的执行判断；Taskcraft 不作保证。

共享 scope、验证或锚点不会自动让 child 变成 blocked。若 Planner 判断它们确实要求先后顺序，必须写成显式 `dependsOn`。首版不设计并行预算、并发控制、互斥锁或 replan+并行的自动影响传播。

## 6. Plan 与 Frame 合同

## 6.1 L3 Frame Result

L3 使用独立于 L2 的 Frame schema：

```json
{
  "objective": "让 L3 支持真实模块拆分和父级集成",
  "scope": ["task hierarchy", "L3 lifecycle", "CLI", "Watch"],
  "acceptanceAnchors": [
    {"id":"A-01","text":"每个模块拥有独立生命周期和公开状态"},
    {"id":"A-02","text":"父任务只在 required children 全部完成后进入 Integrate"}
  ],
  "nonGoals": ["Taskcraft 不调度 subagent"]
}
```

锚点 ID 在父任务内稳定，不允许通过数组重排改变语义。

## 6.2 L3 Plan Result

module `scope` 是**主战场提示和协调事实**，不是写入授权或红线。模块间允许出现合理代码交叉；Reducer 不因 changed files 超出 scope 而拒绝完成。Implementer 必须在结果中披露实际 changed scope，Reviewer 根据验收覆盖、共享合同影响和是否发生未声明扩边进行判断。

候选合同示例：

```json
{
  "decomposition": {
    "mode": "modules",
    "reason": "数据合同、父级投影和 Watch 可以独立验收",
    "attemptedSplits": []
  },
  "modules": [
    {
      "key": "relation-contract",
      "title": "建立 revision-scoped 父子关系合同",
      "level": 2,
      "reason": "涉及共享存储合同并需要独立 Review",
      "objective": "保存 child membership、coverage 和 dependency",
      "scope": ["migrations", "store", "contract tests"],
      "acceptance": ["父 revision 可以引用真实 child task"],
      "nonGoals": ["不实现 Watch UI"],
      "covers": ["A-01"],
      "reviewFocus": ["foreign keys", "append-only history"]
    },
    {
      "key": "parent-projector",
      "title": "实现父任务聚合投影",
      "level": 2,
      "reason": "跨任务状态聚合需要独立 Review",
      "objective": "根据 required child facts 推导 parent status 和 next",
      "scope": ["projector", "query", "CLI"],
      "acceptance": ["父任务不会在 child 未完成时进入 Integrate"],
      "nonGoals": ["不启动 subagent"],
      "covers": ["A-01", "A-02"],
      "reviewFocus": ["status precedence", "waiting propagation"]
    }
  ],
  "coverage": [
    {"anchorId":"A-01","disposition":"required","moduleKeys":["relation-contract","parent-projector"]},
    {"anchorId":"A-02","disposition":"required","moduleKeys":["parent-projector"]}
  ],
  "dependencies": [
    {"task":"parent-projector","dependsOn":"relation-contract"}
  ],
  "executionMode": "serial",
  "sharedValidations": [
    {"id":"full-check","reference":"pnpm check","owner":"parent-integrate"}
  ],
  "integrationPath": "父级 Integrate 运行全量合同测试并核对锚点覆盖"
}
```

`module.key` 是 Plan 内稳定键，不是预先猜测的 task id。Feasibility pass 事务创建真实 task id 后写入映射。

当 `decomposition.mode = single` 时，`attemptedSplits` 必须至少包含一项候选拆分、候选模块和失败原因；`modules` 模式允许为空。这样 Feasibility Review 审核的是实际权衡，而不是一句“时间紧”或“没必要拆”。

## 6.3 语义校验，不只做 JSON Schema 校验

Reducer 在 Review pass 时必须检查：

- `modules` 模式至少两个 module；`single` 模式 modules 为空；
- `single` 模式至少提供一个 attempted split 及非空失败原因；
- module key 唯一；
- module Level 只能是 1 或 2；Level 3 必须返回父 Plan 继续拆分；
- dependency 两端都存在且没有环；
- required anchor 至少有一个覆盖 module；
- deferred/descope anchor 有非空理由；
- coverage 不引用未知 anchor/module；
- shared validation owner 是已知 module 或 `parent-integrate`；
- child 目标、验收和范围非空；
- scope 只做语义完整性与协调提示校验，不做 changed-path 写入拒绝；
- 超过软预算时有拆分理由，缺失时形成 Feasibility finding，而不是数据库错误。

## 7. SQLite 合同

## 7.1 复用现有字段

`tasks.parent_task_id` 继续表达永久父子层级，不复制一份同义 `parent_id`。

## 7.2 新增 revision-scoped definition tables

建议新增以下 append-only 表，命名可在实现前按现有 migration 规范调整：

### `lifecycle_acceptance_anchors`

```text
task_id
lifecycle_revision
anchor_id
text
disposition: required | deferred | descope
reason nullable
PRIMARY KEY(task_id, lifecycle_revision, anchor_id)
```

### `lifecycle_child_requirements`

```text
parent_task_id
parent_lifecycle_revision
module_key
child_task_id
requirement_status: required | not_required
order_index
source_plan_attempt_id
PRIMARY KEY(parent_task_id, parent_lifecycle_revision, module_key)
UNIQUE(parent_task_id, parent_lifecycle_revision, child_task_id)
```

### `lifecycle_anchor_coverage`

```text
parent_task_id
parent_lifecycle_revision
anchor_id
child_task_id
PRIMARY KEY(parent_task_id, parent_lifecycle_revision, anchor_id, child_task_id)
```

### `lifecycle_task_dependencies`

```text
parent_task_id
parent_lifecycle_revision
task_id
depends_on_task_id
PRIMARY KEY(parent_task_id, parent_lifecycle_revision, task_id, depends_on_task_id)
```

### `lifecycle_validation_assignments`

```text
parent_task_id
parent_lifecycle_revision
validation_id
reference
owner_kind: child | parent_integrate
owner_child_task_id nullable
PRIMARY KEY(parent_task_id, parent_lifecycle_revision, validation_id)
```

### `lifecycle_execution_sources`

记录 execution revision 的 `modules | single` 模式、planning revision、源 Plan
Attempt 与 Feasibility Review Attempt；父 Projector 只认这条已接受来源。

### `lifecycle_inherited_planning`

记录 child execution revision 对父 task/revision、module key 和源 Plan Attempt 的
继承引用；它是规划 provenance，不是伪造的 Frame/Plan Attempt。

这些表属于 lifecycle definition facts：每个父 revision 的模块合同一旦接受就不可修改。运行状态继续来自 child 自己的 Attempt、Review、Evidence、Blocker 和事件，不在关系表保存缓存状态。

## 7.3 为什么不把全部内容只留在 Plan JSON

Plan Attempt 的 `result_json` 仍保留原始提案，但只依赖 JSON 会导致：

- 外键无法保证 child 引用存在；
- Projector 每次需要解析和自行拼接关系；
- coverage、dependency 和 owner 无法做数据库完整性检查；
- 重规划后的 revision lineage 难以查询；
- doctor 很难区分合同损坏与普通格式问题。

因此 Plan JSON 是提交载荷和审计原文，Review pass 后的 normalized definition tables 是被接受的执行合同，两者不是第二真相源：前者是提案事实，后者是接受后的 immutable contract。

## 8. Command / Reducer 设计

## 8.1 不增加逐 child 手工创建流程

公开 happy path 不要求：

```text
tc task new --parent ...
tc task link ...
tc task coverage add ...
```

这些命令会重现 KP 的操作负担，并允许 Plan 与真实 child 漂移。

推荐把物化放进现有 Feasibility `review pass` 事务。命令成功时返回：

```json
{
  "taskId": "T-10",
  "newRevision": 2,
  "materializedChildren": [
    {"moduleKey":"relation-contract","taskId":"T-11","level":2,"reused":false},
    {"moduleKey":"parent-projector","taskId":"T-12","level":2,"reused":false}
  ],
  "next": "tc run T-11"
}
```

完整可运行集合通过随后的 `tc task next T-10 --json` 从父 Projector 读取；Review
结果不维护第二份 `runnableWorkItems`。

## 8.2 Reducer 边界

应抽出一个内部 `acceptL3Plan()` reducer operation，由 `reviewPass` 在确认 purpose 为 feasibility、reviewed attempt 为最新 Plan Attempt 时调用。它负责：

1. 读取并语义校验最新 Frame、Plan 和 Review facts；
2. 创建 child task rows；
3. 从 module proposal 为每个 child 编译 inherited planning contract 和从 execute 开始的 L1/L2 execution revision 1；不得生成伪造 host planning Attempt；
4. 写入 anchors、membership、coverage、dependencies、validation owners；
5. 编译父 execution revision；
6. 更新父 current lifecycle revision；`reviewPass` 在同一事务末尾统一推进 CAS revision；
7. 写 child created、plan accepted、children materialized 等审计事件；
8. 在事务结束前重新投影父/child，确保没有不可能状态。

Command service 仍是唯一写入口，Adapter、Watch 和 Projector 不写关系。

## 8.3 事件与错误

新增事件至少覆盖：

- `l3.plan_accepted`
- `task.child_materialized`
- `l3.child_reused`（重规划复用时）
- `l3.child_requirement_replaced`（重规划时）

稳定错误至少区分：

- Plan Schema 不合法；
- anchor coverage 不完整；
- dependency 引用未知 module；
- dependency cycle；
- validation owner 无效；
- accepted Plan/review 引用漂移；
- child materialization 事务失败。

错误必须保持 problem / impact / remediation / context 格式，不用 fallback 自动删模块或改成 single。

## 9. Replan、取消和历史

## 9.1 Replan

父任务任何阶段收到 `replan_required` 时：

1. 创建新的 planning revision；
2. 保留旧 execution revision 和所有 child；
3. 新 Plan 可以复用旧 child、增加 child，或把旧 child 标为不再 required；
4. 已完成或已有外部副作用的 child 不得静默删除；
5. 新 Feasibility pass 创建新的 execution revision 和 required membership 集合；
6. Integrate 只消费当前 execution revision 的 required children，但历史视图显示 lineage。

replan 时仍在执行的 child 由主 Agent 决定中断时机并停止自己的宿主 subagent；Taskcraft 不尝试调用宿主停止能力。Taskcraft 的职责是在新父 revision 中把被替换 child 记录为 `not_required`，从父级 `runnableWorkItems`/`next` 排除，并保留旧 membership、Attempt、Evidence 和副作用记录。

`not_required` 是父 revision 对 child 的需求关系，不是 child 自身的公开状态。child 若仍有 running Attempt，主 Agent随后根据真实结果显式记录取消、失败、完成或保留；Taskcraft 不静默把它改成 done/cancelled。Entry/父级投影必须优先锚定 root parent 及当前 required children，避免一个已 `not_required` 但尚未收口的 child 造成错误恢复。

首版不推断 replan 对并行 sibling 的连锁影响。共享 scope、验证或锚点只能提醒 Reviewer 检查；只有新 revision membership 和显式 dependency edge 改变 runnable facts。

## 9.2 Child 被取消

required child 被取消时，父任务进入 `waiting(needs_decision)`，next 指向父任务 replan/查看命令。父任务不能把 cancelled 自动当作 skipped，也不能继续 Integrate。

## 9.3 父任务被取消

不级联取消 child。静默级联可能终止仍有价值或已产生外部副作用的工作，而且 Taskcraft 无法真正停止宿主 subagent。已确认合同为：

- 没有 active child 时允许取消父任务；
- 有 queued/active/waiting required child 时拒绝并给出 child 列表与明确 remediation；
- 主 Agent 先停止自己启动的宿主 subagent，再逐个记录 child 的取消、完成或 `not_required`；
- Taskcraft 不提供 `--cascade`，也不批量写入与宿主现实不一致的 cancelled 事实。

## 10. Query、CLI、Watch 与 Entry

## 10.1 单 Projector 扩展

不建立 `ParentProjector` 第二套状态机。现有 `project()` 增加一次 relation graph snapshot，并用 memoization 投影父任务及 required children：

```text
load parent snapshot + current lifecycle
load revision-scoped child requirements
project each required child once
derive runnableWorkItems / blockers / children gate
derive existing five-state projection
```

Doctor 检查 hierarchy/dependency cycle，运行时 Projector 遇到 cycle 必须显式失败，不能吞掉并返回空 next。

## 10.2 CLI

- `tc task show <parent>`：显示锚点、覆盖、children 状态、依赖、共享验证 owner 和 parent next；
- `tc task next <parent> --json`：返回完整 `runnableWorkItems`；
- `tc task list`：保留平铺默认视图，增加父任务/child 标记；是否增加 `--parent` 过滤可在实现阶段按现有 CLI 规范确认；
- child 的现有 `tc run`、`review`、`wait/resume` 命令不新增平行实现。

## 10.3 Watch

父任务详情使用折叠树展示：

```text
T-10 L3 active  2/3 children done
  ├─ T-11 L2 done
  ├─ T-12 L2 active   next: tc review start T-12 ...
  └─ T-13 L1 waiting  needs_input
```

锚点覆盖、依赖和共享验证来自同一 query DTO，不在前端重新推导。

## 10.4 Entry Hook

Entry Hook 不注入整棵树，只注入紧凑父锚点和 projector 选出的确定性 next。Agent 运行 `tc task next <parent> --json` 后获得完整 runnable child 集合。Stop Hook 不恢复。

## 11. 兼容与迁移

Taskcraft 尚未正式使用，推荐 clean contract change：

- L3 compiler 升级到 `tc-l3/2`；
- 新建迁移增加 relation/anchor definition tables 和必要 reason/event enum；
- 同步 `development/contracts/storage.sql`、JSON Schema、fixtures、CLI spec 和 Watch DTO；
- 不保留旧 `children.maxItems=1` 的兼容别名或 no-op wrapper；
- 已存在的开发数据库如果含 `tc-l3/1` 任务，保留旧 revision 可读；新 replan 编译为 v2 planning revision，不原地改写历史。

L1/L2、五个公开状态、Agent-driven continuation、Entry-only Hook 和单 reducer/projector 不变量保持不变。

## 12. 备选方案及拒绝理由

### A. 父任务内动态生成多个 execute 节点

拒绝：模块没有独立 Task 语义，共享 CAS，waiting/review/retry 不独立，重规划图膨胀。

### B. 只实现 Trellis 式 parent/child，不做锚点覆盖

拒绝：可以拆出真任务，但无法证明原始产品验收没有在拆分中丢失，也缺少反过度拆分约束。

### C. 完整照搬 KP Phase/Board/角色链

拒绝：规划规则强，但操作成本高；重复状态和文档会削弱 Taskcraft 的 SQLite 单一事实源优势。

### D. Plan JSON 保持信息性，由 Agent 手工创建 child

拒绝：Plan 和真实 Task 会漂移，创建过程非原子，Agent 每次都要做重复状态操作。

### E. 所有 L3 强制至少两个 child

拒绝。虽然它能统一父级图，但会把不可分割的高风险任务强拆成步骤型假模块。产品已确认保留通过严格 Feasibility Review 的 `single L3`。

## 13. 主要风险

### 投影复杂度

父任务需要读取一层 child 投影。实现必须批量加载关系并在一次投影调用中 memoize，避免 Watch 列表出现 N+1 查询和重复子投影；不实现递归任务树遍历。

### Revision lineage

planning revision、execution revision 和 replan 之间的引用必须有明确外键和 doctor 检查，否则历史可读但无法证明哪个 Plan 生成了哪些 children。

### 过度拆分从“文档问题”变成“真实任务膨胀”

child 一旦成为真实 Task，错误拆分成本更高。Feasibility Review 必须把拆分理由、合并判断和软预算作为核心审核内容，而不是只检查 JSON 合法。

### Child 不重复规划要求禁止 nested L3

如果 inherited child 从 execute 开始，它就不能同时承担一套新的 L3 Plan/children graph。产品已确认父 L3 只能物化 L1/L2 child；Plan schema、Reducer 和 doctor 都必须拒绝 nested L3，而不是用伪 completed Plan 掩盖问题。

### Not-required child 仍可能有宿主运行

Taskcraft 可以停止推荐该 child，却不能停止正在运行的 subagent。Entry、task list 和父级 next 必须区分 current required child 与 historical/not-required child；主 Agent 负责最终记录实际停止或完成结果。

### 父状态的等待传播

一个 child waiting、另一个 child runnable 时，父任务仍应 active；全部路径阻塞时才 waiting。优先级规则必须用 fixture 覆盖，不能靠 UI 临时判断。

### 原子事务变大

一次 Feasibility pass 需要创建多个 child graph。默认模块预算能控制事务规模；任何失败必须完整回滚，不允许部分成功。

## 14. 验证策略

实现阶段至少需要以下验证层次：

1. **Schema / migration tests**：外键、append-only、anchor/coverage/dependency 完整性。
2. **Reducer transaction tests**：Feasibility pass 原子创建 children；中途失败完整回滚。
3. **Projector tests**：多 runnable child、依赖串行、局部 waiting、全部 waiting、cancelled child、全部 done、Integrate gate。
4. **Review/replan tests**：Plan changes_requested、replan replacement、旧 child/evidence 可查询。
5. **CLI tests**：真实公开命令完成两 child L3 闭环，不通过 fixture 直插伪造能力。
6. **Watch tests**：父子树、锚点覆盖、child waiting 和 parent next 同源显示。
7. **Doctor tests**：孤儿 child、缺失 coverage、dependency cycle、plan/review/revision 引用损坏。
8. **真实宿主样本**：至少一个 Codex 或 Claude 会话从父 L3 恢复并继续正确 child；不得以本地构造 breadcrumb 代替。

## 15. 审核 Agent 重点问题

请审核 Agent 不只检查文档是否完整，重点挑战以下问题：

1. 两阶段 lifecycle revision 是否保持“当前 revision obligations 是完成合同”的不变量？
2. Feasibility `review pass` 内物化 children 是否职责过重，是否存在更低摩擦且同样原子的边界？
3. `parent_task_id` + revision-scoped membership 是否语义清晰，还是形成了重复真相源？
4. normalized tables 是否过多；哪些字段可以删除而不降低引用完整性？
5. 父任务五状态聚合是否存在未覆盖的 precedence 冲突？
6. replan 后复用旧 child 的身份、revision 和 evidence 应如何精确校验？
7. Plan schema、Reducer、doctor 和迁移是否一致拒绝 nested L3，并能把“模块仍需拆分”明确路由回父 Plan？
8. `single` 模式是否应保留，Feasibility Review 如何防止它成为偷懒通道？
9. 公开 CLI 是否仍然足够少，是否无意复制了 KP 的操作负担？
10. 方案是否继续遵守“不调度 subagent、不恢复 Stop Hook、SQLite 唯一可写 Task Store”的产品边界？

## 16. 当前产品决策

### P1：是否允许 `single` L3（已确认：允许）

任务确实无法合理拆分时允许 `single`，不强制制造 child。Plan 必须提供非空理由、至少一个 attempted split 及失败原因，并通过 Feasibility Review；通过后父 L3 进入自身 execute/delivery review/integrate/record execution revision。

### P2：是否允许 child 再次是 L3（已确认：不允许）

永久不支持 nested L3，这不是等待未来开放的 MVP 限制。父 L3 只物化 L1/L2 child，任务树深度固定为一层。若 module proposal 仍需要再次拆分，Feasibility Review 不得通过，必须回父 Plan 将其拆成 sibling modules。Plan schema、Reducer 和 doctor 都应拒绝 Level 3 child。

### P3：父任务取消是否级联（已确认：不级联）

父 L3 存在未完成 required child 时拒绝取消。主 Agent 负责停止宿主执行并逐个记录 child 处置；Taskcraft 不提供 cascade，不假装能够停止 subagent。
