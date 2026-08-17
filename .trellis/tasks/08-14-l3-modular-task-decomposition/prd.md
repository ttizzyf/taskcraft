# Design modular L3 task decomposition

## Goal

让 L3 从“治理更严格的单体任务”升级为可按交付模块拆分、独立推进并由父任务集成收口的复杂任务模型，同时避免为了拆分而拆分。用户应能从父任务看到产品验收覆盖、子任务状态、真实依赖、共享验证归属和最终集成结果，而 Agent 不需要维护 KP 式重复文档、角色仪式或第二状态源。

## Background and confirmed facts

- 当前 L3 固定物化 `frame -> plan -> feasibility review -> execute -> delivery review -> integrate -> integration review -> record`，只有一个 `execute-1`。
- 当前 Plan 的 `children`、`validationOwners` 与 Integrate 的 `childrenResults` 都限制为最多一个条目；这个 child 只是信息性声明，不是 Task。
- SQLite `tasks.parent_task_id` 已存在并受外键约束，但 `TaskNewInput`、`tc task new`、Reducer 和 Projector 尚未提供父子任务能力；当前创建任务总是写入 `NULL`。
- 当前 Projector 只投影单个任务的 lifecycle，不聚合 child 状态；CLI、Watch 与 breadcrumb 都消费同一个 Projector。
- Taskcraft 的既定边界是不启动或调度 subagent；Agent 决定串行、并行和宿主工具使用，Taskcraft 只保存事实、校验合同并提供下一步。
- KP Phase 的可取部分是产品验收锚点、拆卡覆盖表、合并优先、软拆卡预算、独立依赖与共享验证归属；其多角色仪式、重复文档和密集状态操作不适合照搬。
- Trellis 的可取部分是父任务拥有源需求、任务地图、跨 child 验收和最终集成，child 必须可以独立规划、执行、检查与归档；父子关系本身不表达依赖。
- Taskcraft 尚未正式投入使用，本次可以优先保持合同干净，不为尚未发布的 L3 单 child 结果格式长期保留兼容别名。

## Requirements

### R1. L3 Plan 必须给出可审计的拆分判断

- Plan 必须明确选择 `single` 或 `modules`，并记录判断理由。
- `modules` 只用于两个及以上可独立验收的交付模块。
- `single` 只用于高治理强度但不存在有意义模块边界的任务，不能作为逃避规划的默认值。
- 如果选择 `single`，Plan 必须列出至少一个尝试过的拆分方案及其失败原因；该抓手与 `single` 同期交付，不能先开放逃生口再延后审核合同。
- Feasibility Review 必须审核拆分判断、模块边界、验收覆盖、依赖与集成路径。
- `single` 通过 Feasibility Review 后不创建形式主义 child，父 L3 进入自身 `execute -> delivery review -> integrate -> optional integration review -> record` execution revision。

### R2. 父任务验收锚点是拆分依据

- L3 Frame/Plan 形成稳定、不可重排的产品验收锚点 ID。
- 锚点描述用户可观察结果或必须保持的产品/系统边界，不描述文件、函数或实现步骤。
- 每个锚点必须被一个或多个 child 覆盖，或显式标记 `deferred` / `descope` 并记录理由。
- 覆盖关系作为 SQLite canonical fact 保存，由 CLI、Watch 和 export 投影；不维护独立 Markdown 覆盖表作为第二真相源。

### R3. 模块 child 是真实 Task

- Plan 通过后，`modules` 中的每个交付模块必须物化为一条真实 `tasks` 记录并设置 `parent_task_id`。
- 每个 child 拥有自己的 Level、lifecycle revision、公开状态、Attempt、Review、waiting/resume、evidence、blocker、CAS revision 与审计事件。
- child Level 只允许 L1 或 L2，不允许 L3 child 继续物化下一层 children。若候选模块仍需要 L3 级拆分，父 Plan 必须回退并把该模块继续拆成同一父任务下的 sibling modules。
- child 标题、目标、范围、验收、非目标和判级理由来自已通过 Feasibility Review 的 Plan 合同，不能在物化时静默改写。
- child 不重复执行父 Plan 已完成的 Frame/Plan。物化事务必须把 module proposal 编译为带明确来源引用的 inherited planning contract，使 child 的第一个真实 Agent 工作节点从 execute 开始；不得伪造一次宿主执行来冒充已完成规划。
- module `scope` 是主战场与协调提示，不是写入红线。跨出 scope 不被 Reducer 拒绝，但执行结果必须披露实际 changed scope，并由 Review 按验收、协调影响和未声明扩边检查。
- 父子关系与依赖关系分离；依赖必须作为显式、可校验的边保存。

### R4. 以最少可执行模块数为默认目标

- 不得因为多个 bullet、文件、前后端步骤或锚点而机械拆卡。
- 只有独立验收/回滚/阻塞边界、明显不同的 Review 关注点、上下文窗口过大、写入冲突隔离或真实并行收益，才构成继续拆分的理由。
- 共享启动上下文、主要写入域、强串行依赖和同一交互闭环的工作优先合并。
- 共享写入域、共享验证或共享锚点是协调信号，不自动成为完成依赖，也不自动阻止 runnable；是否需要顺序约束必须由显式 `dependsOn` 表达。
- 小型 L3 建议 1–3 个模块，中型 L3 建议 3–5 个模块；超过 5 个是 advisory 警告并要求解释，不设置数据库硬上限。

### R5. 父任务负责治理和集成

- 模块化 L3 的父任务主线为 `frame -> plan -> feasibility review -> children gate -> integrate -> optional integration review -> record`。
- `modules` 父任务不拥有产品实现用的 `execute`。无法诚实归属任一 child 的直接交付物说明模块边界不完整，Feasibility Review 必须退回 Plan 重新拆分；确实不可拆时应选择 `single`。
- `children gate` 不是 Agent 执行节点，而是由 Projector 根据 required children 的当前投影自动计算的 gate。
- required child 全部 `done` 后父任务才能进入 integrate；child `waiting`、`cancelled` 或失败时，父任务必须显示对应聚合状态和可操作的 next，而不能伪装为可集成。
- Integrate 必须引用真实 child task id、完成 revision 和 evidence，而不是接受 Agent 自报的任意字符串结果。

### R6. 调度建议是事实，不是调度器

- Plan 可以记录 `serial | parallel | hybrid`、依赖边、写入范围、协调面和共享验证 owner。
- Taskcraft 根据依赖和 child 状态列出可运行 children 与推荐 next；不创建 subagent、不管理 worktree、不替宿主执行派发。
- 多个 child 可同时 runnable；CLI/JSON 必须返回完整集合，breadcrumb 只保留紧凑父锚点和一个确定性的首选命令。
- `runnable` 只由 lifecycle gate 和未满足的显式 `dependsOn` 决定。Taskcraft 不根据 scope 重叠、共享验证、共享锚点推断互斥，不引入并行预算、并发额度或锁调度。

### R7. 保持单一事实源和低摩擦

- 所有父子、锚点、覆盖、依赖、共享验证和集成引用都由 Command service 在事务内写入 SQLite。
- 不新增 Board、任务卡 Markdown、角色状态或 telemetry 作为必填写路径。
- Agent 完成一次结构化 Plan 后，由一个 reducer command 原子校验并物化整个拆分，不要求逐个手工执行 `task new` 和同步父任务。
- CLI 文本、JSON、Watch、breadcrumb、doctor 和 export 必须来自同一查询模型与 Projector。

### R8. Review 与重规划必须保持引用完整性

- Feasibility Review 通过前不得物化 children。
- `replan_required` 可以增加、替换或取消尚未完成的 child，但必须保留旧 task、attempt、evidence 和映射历史。
- 已经完成或已经产生外部副作用的 child 不得被静默删除；新 revision 必须记录保留、取代或不再要求的决定。
- replan 时仍在宿主执行的 child 由主 Agent 决定何时停止对应 subagent；Taskcraft 不控制宿主运行，只记录 child 对新父 revision 已 `not_required` 并从父级 next 中移除。
- child 被标为 `not_required` 不等于其 Task 事实被删除或自动取消；主 Agent 随后应根据真实执行情况记录取消、失败、完成或保留结果。
- replan 与并行 child 的影响传播首版不做推断；除显式依赖与新 revision membership 外，不根据共享 scope、验证或锚点自动判定 sibling 失效。
- Delivery Review 属于各 child 自己的生命周期；父任务 Integrate/Integration Review 负责跨 child 的整体行为，不重复逐 child Review。

### R9. 父任务取消不级联

- 父 L3 存在 queued、active 或 waiting 的 required child 时，`tc task cancel <parent>` 必须拒绝，并返回需要先处置的 child 列表和 remediation。
- Taskcraft 不自动停止宿主 subagent，也不批量伪造 child cancelled 事实。
- 主 Agent 负责先停止自己启动的宿主执行，再逐个记录 child 的取消、完成或通过 replan 标记为 `not_required`；全部 required child 已明确处置后才能取消父任务。
- 已完成 child 和已有外部副作用的事实永久保留，父任务取消不删除 child、Attempt、Evidence 或 relation history。

## Acceptance Criteria

- [x] AC1：公开 CLI 可以创建一个 L3 父任务，完成 Frame/Plan/Feasibility Review 后原子生成至少两个真实 child task；每个 child 都有 `parent_task_id`、独立 lifecycle 和独立公开状态。
- [x] AC2：Plan 中每个产品验收锚点都能从查询模型看到其 child 覆盖，未覆盖锚点会阻止 Feasibility Review 通过，除非显式 `deferred` / `descope` 且带理由。
- [x] AC3：两个强串行 child 通过显式 `dependsOn` 控制 runnable 顺序；没有未满足显式依赖的 children 可以同时投影为 runnable，即使存在 advisory coordination surface，Taskcraft 也不启动 subagent 或推断互斥。
- [x] AC4：child 的 waiting/resume、Review 回流、retry 和取消不会篡改兄弟任务事实；父任务能正确聚合并给出下一步。
- [x] AC5：父任务在 required children 未全部完成时不能进入 Integrate；全部完成后 Integrate 只接受真实 child task/revision/evidence 引用。
- [x] AC6：重规划替换 child 时旧 child、attempt、evidence 和旧 revision 仍可查询，新 revision 的 required child 集合明确且可审计。
- [x] AC7：CLI、Watch、breadcrumb、doctor 和 schema/fixture 测试对父子关系、锚点覆盖、依赖、共享验证 owner 和聚合状态使用同一个 canonical query/projector 结果。
- [x] AC8：典型小型模块化 L3 不需要 KP 式 Board、Markdown 卡、角色切换或逐 child 手工建卡；一次 Plan 提交即可建立执行图。
- [x] AC9：现有 L1/L2 行为与五个公开状态保持兼容，Stop Hook 不重新引入，Agent-driven continuation 合同不改变。
- [x] AC10：提供至少一个公开 CLI 可回放样本，覆盖父任务创建、两 child 物化、依赖推进、child Review、父级 Integrate 和最终 done。
- [x] AC11：物化后的 child 不重新运行父 Plan 已完成的 Frame/Plan；其 inherited planning contract 可追溯到父 Plan attempt，且 task show/doctor 不把继承事实伪装成宿主执行 Attempt。
- [x] AC12：Plan schema 和 Reducer 拒绝 Level 3 child；Review 发现某模块仍需再次拆分时必须回父 Plan 重拆，Task Store 不生成超过一层的父子树。
- [x] AC13：一个确实无法合理拆分的 L3 可以提交 `single` Plan；只有在至少记录一个 attempted split 及失败原因并通过 Feasibility Review 后，父任务才进入自身 execute，且不会创建单 child 包装。
- [x] AC14：父 L3 存在未完成 required child 时取消命令失败并列出待处置 children；命令不会停止宿主运行或级联写 child cancelled，逐个处置后父任务才可取消。

## Completion evidence（2026-08-17）

- AC1/3/4/5/8/10/11/13/14：构建后的公开 `dist/cli.js` 在全新临时目录完成
  modules 与 single 两条闭环，终点输出 `Doctor: 8 checks passed` 和
  `public-cli-smoke-ok`。modules 样本覆盖 T-2/T-3 真实物化、显式依赖、父取消
  拒绝、T-2 waiting/resume、Delivery Review、真实 child revision/evidence
  Integrate 和父 done。
- AC2/6/7/9/12：migration、accepted-plan transaction、Projector、replan/reuse、
  doctor、Entry root、CLI/Watch 同源和 Level 3 child 拒绝均由全量测试覆盖；
  额外回归验证 direct child 不能绕过 `dependsOn`，Integrate 不能重复引用同一 child。
  `pnpm check` 为 54 files / 396 tests 全绿。
- UI 与跨层：`pnpm smoke:watch` 在允许监听 `127.0.0.1` 的环境下 6/6 通过。
- 真实宿主：Codex 0.147.0 通过公共 `tc agent test-entry-hook --agent codex --json`，
  `ok=true`、`entryInjected=true`，未使用 trust bypass。Claude 仍待成功复核，
  只阻断更高层的双宿主狗粮化迁移门，不阻断本 L3 任务的单宿主完成条件。

## Out of Scope

- Taskcraft 自己创建或调度宿主 subagent、worktree、分支或远程 runner。
- 团队账号、云端协调、远程权限和跨机器调度。
- 照搬 KP 的 Strategist/Planner/Dispatcher/Implementer/Reviewer/Integrator 角色状态机。
- 为每个文件、函数、测试或实现步骤创建 child。
- 将父子树本身当作依赖图。
- 自动级联取消 child，或由 Taskcraft 停止宿主 subagent。
- 在本轮规划中恢复 Stop Hook 或引入其他强制续跑机制。
