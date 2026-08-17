# Implement modular L3 task decomposition

> 状态：Implemented and checked（2026-08-17）。用户已批准实现；Checkpoint A–F、
> 公开 CLI smoke、真实 Codex Entry 和最终质量门均已完成。

## 1. Structural judgment

这是结构性能力，不是给 `children.maxItems` 打补丁。它同时改变 SQLite definition facts、L3 compiler、Feasibility Review 事务、父子任务投影、取消/replan 语义、CLI/Watch/doctor 和真实宿主恢复路径。

实现必须守住以下不变量：

- SQLite 是唯一可写 Task Store，Command service 是唯一写入口；
- lifecycle revision 和已接受的父子合同 append-only；
- 单 Reducer 写事实，单 Projector 推导五个公开状态；
- Taskcraft 不调度 subagent，不引入 Stop Hook、并行预算或并发控制；
- 父子树只有一层，child 只能是 L1/L2；
- child 继承父 Plan，真实 Agent 工作从 execute 开始；
- `single L3` 保留，但必须通过 attempted split + Feasibility Review；
- 父任务取消不级联。

本任务不再拆成 Trellis child tasks。原因是 migration、accepted-plan transaction、parent projector 和 public DTO 共享同一组合同并具有强完成依赖；拆成多个独立任务会增加 schema/fixture/Review 协调成本，却没有真实并行收益。执行采用一个任务内的顺序 checkpoint。

## 2. Checkpoint A — Freeze storage and public contracts

### Changes

- 新增 `migrations/0002_l3_modular_tasks.sql`，只追加 relation/anchor definition tables 与必要索引；不修改已应用的 `0001_initial.sql`。
- 同步 `development/contracts/storage.sql`。
- 增加以下 revision-scoped、append-only definition facts：
  - acceptance anchors；
  - child requirements / moduleKey → child task id；
  - anchor coverage；
  - explicit task dependency edges；
  - shared validation assignments；
  - inherited planning provenance。
- 保留 `tasks.parent_task_id` 作为永久层级；membership 表只表达某个父 execution revision 是否 required，避免同义字段重复。
- 扩展 query model，优先新建聚焦模块（例如 `src/store/task-relations.ts`），避免继续膨胀 `query.ts`。
- 增加 Plan/Frame result schema 与独立语义 validator：
  - `single | modules`；
  - attempted splits；
  - L1/L2 module proposals；
  - anchors / coverage；
  - dependencies；
  - execution mode / coordination surface；
  - shared validation owner；
  - integration path。

### Tests first

- migration 从只含 0001 的数据库升级成功且 ledger 正确；
- 新表外键、唯一键和 append-only trigger 生效；
- unknown anchor/module、dependency cycle、Level 3 child、缺失 coverage、非法 owner 被拒绝；
- `single` 缺 attempted split 或失败原因被拒绝；
- scope 重叠或 changed scope 超界不触发存储拒绝。

### Gate

```bash
pnpm exec vitest run --testTimeout=60000 tests/store/migrations.test.ts tests/contracts/schemas.test.ts
```

## 3. Checkpoint B — Split L3 into planning and execution compilers

### Changes

- 将 `tc-l3/1` 升级为 `tc-l3/2`，保留旧 revision 只读可查询。
- 重构 `src/core/lifecycle/l3.ts` / `src/core/reducer/l3-materialize.ts`，必要时拆为小模块：
  - planning revision：`frame -> plan -> feasibility review`；
  - modules execution revision：children gate facts + `integrate -> optional integration review -> record`；
  - single execution revision：`execute -> delivery review -> integrate -> optional integration review -> record`；
  - inherited child L1/L2 execution revision：从 execute 开始，不生成假的 Frame/Plan host Attempt。
- child task fields从 accepted module proposal 编译；scope 保持软边界。
- execution revision 明确引用 source Plan attempt 和 Feasibility Review attempt。

### Tests first

- planning、modules execution、single execution 和 inherited L1/L2 child graph 精确匹配合同；
- child first runnable node 是 execute；
- child 规划来源可查询且不出现在 `node_attempts` 中伪装宿主执行；
- old `tc-l3/1` revision 保持可读，新 replan 编译 v2。

### Gate

```bash
pnpm exec vitest run --testTimeout=60000 tests/core/reducer.task-new.test.ts tests/core/projector.l3.test.ts tests/core/projector.l3-fixtures.test.ts
```

## 4. Checkpoint C — Accept Plan and materialize children atomically

### Changes

- 新增内部 reducer operation `acceptL3Plan()`，仅由最新 Plan Attempt 的 Feasibility `review pass` 调用。
- 在一个 `BEGIN IMMEDIATE` 事务中：
  1. 验证 Frame/Plan/Review 引用与 CAS；
  2. 运行 Plan 语义校验；
  3. `single`：创建父 single execution revision，不创建 child；
  4. `modules`：生成所有 child task id、task rows 和 inherited L1/L2 graph；
  5. 写 anchors、membership、coverage、dependencies、validation owner、provenance；
  6. 创建父 modules execution revision；
  7. 更新父 current lifecycle revision；
  8. 写父/child 审计事件并在提交前重投影。
- 任一步失败时 Review pass、所有 child rows、relations、graphs 和 events 全部回滚。
- command result 返回 materialized children、父 revision、完整 runnable work items 与确定性 next。

### Tests first

- 两 child happy path；
- single happy path；
- 第 N 个 child 创建失败时零部分写入；
- duplicate module key、循环依赖、Level 3 child、coverage gap、无效 owner 稳定失败；
- 并发/CAS 冲突不会重复物化 child；
- event task_seq 连续，plan/review/child/revision 引用完整。

### Gate

```bash
pnpm exec vitest run --testTimeout=60000 tests/core/reducer.review-pass.test.ts tests/core/reducer.review-replan.test.ts tests/core/reducer.task-new.test.ts
```

## 5. Checkpoint D — Parent aggregation, replan and cancellation

### Changes

- 扩展现有 `project()`，不创建第二 Projector：批量读取一层 required children 并 memoize child projection。
- 新增 `runnableWorkItems`，硬 runnable 只由 child lifecycle gate 和显式 `dependsOn` 决定。
- scope、shared validation、shared anchors 只进入 coordination DTO，不阻止 runnable。
- 父状态 precedence：
  - 任一父节点/required child 可运行 → active；
  - 无可运行工作且 required child waiting → waiting；
  - required child cancelled/关系失效 → waiting(needs_decision)；
  - required children 全部 done → Integrate runnable；
  - Record + 当前 obligations 满足 → done。
- replan 新 revision 写 reused/new/not_required membership；旧 child、Attempt、Evidence 和 relation history不删除。
- 已 `not_required` child 从父 next/Entry 恢复候选排除，但自身事实保留。
- 父取消：存在 queued/active/waiting required child 时稳定失败并列出 child；无 cascade。
- doctor 检查孤儿 child、超过一层树、Level 3 child、coverage gap、dependency cycle、无效 provenance 和 accepted revision 引用。

### Tests first

- 两个同时 runnable children；
- dependency 串行；
- coordination overlap 仍可同时 runnable；
- 一个 waiting、一个 runnable 时父 active；全部 blocked 时父 waiting；
- child cancelled 时父 needs_decision；
- children done 后 Integrate 解锁；
- replan replacement、reuse、not_required 和旧历史；
- unfinished child 阻止父取消，逐个处置后允许；
- Entry 只锚定 root/current required work，不被 historical child 干扰。

### Gate

```bash
pnpm exec vitest run --testTimeout=60000 tests/core/projector.l3.test.ts tests/core/projector.l3-fixtures.test.ts tests/core/reducer.review-replan.test.ts tests/core/reducer.cancel.test.ts tests/core/doctor.test.ts tests/core/breadcrumb.test.ts
```

## 6. Checkpoint E — CLI, Watch and same-source rendering

### Changes

- `tc task show <parent>` 展示 anchors、coverage、children、dependencies、coordination/shared validation、provenance 和 aggregate next。
- `tc task next <parent> --json` 返回完整 `runnableWorkItems`；现有字符串 next 保持确定性、紧凑。
- `tc task list` 标记 root/child 关系，不引入 Board 状态源。
- Review pass 文本/JSON 输出 materialized children 或 single execution revision。
- Watch board/detail 增加一层 child tree、完成计数、局部 waiting 和 anchor coverage；前端只渲染 query DTO，不重新推导状态。
- Entry breadcrumb 继续只注入 root anchor + deterministic next；Agent 通过 task next 获取全部 runnable work。
- CLI/Watch/doctor 错误继续使用稳定 problem/impact/remediation/context。

### Tests first

- CLI JSON 与文本同源；
- 父 show/next/list 的模块、依赖和 next 正确；
- Watch desktop/mobile 树视图、waiting 和 integrate gate；
- Entry 在父+多个 child active 时仍输出唯一 root anchor；
- no-task、single L3、ordinary L1/L2 不回归。

### Gate

```bash
pnpm exec vitest run --testTimeout=60000 tests/cli/l3.test.ts tests/cli/task.test.ts tests/cli/task-list.test.ts tests/cli/status.test.ts tests/cli/state.test.ts tests/watch/server.test.ts tests/watch/frontend-render.test.ts tests/watch/runtime-hooks.test.ts
```

## 7. Checkpoint F — Specs, fixtures and real public sample

### Changes

- 更新 `development/specs/lifecycle.md`、`architecture.md`、`product.md`、`cli.md` 及相关 ADR/README，删除单 execute/单 child 旧声称。
- 同步 `.trellis/spec/backend/` 中 L3/Reducer/Projector/Entry 相关合同；若不存在合适入口，按 `trellis-update-spec` 流程新增或更新。
- 更新 L3 fixtures，明确区分 planning revision、modules execution revision、single execution revision 和 inherited child provenance。
- 重写 `development/l3-sample.md`：全部通过公开 CLI 完成父 L3 → 两个 child → dependency → child Review → Integrate → done，不用 fixture 直插库伪造。
- 增加 single L3 可回放样本和 attempted split 审核失败样本。

### Gate

```bash
pnpm exec vitest run --testTimeout=60000 tests/contracts/schemas.test.ts tests/cli/l3.test.ts tests/core/projector.l3-fixtures.test.ts
git diff --check
```

## 8. Final validation

按项目验证顺序执行：

```bash
pnpm check
pnpm smoke:watch
git diff --check
```

另外在全新临时目录运行公开 CLI smoke：

1. `tc init`；
2. 创建父 L3；
3. 完成 Frame/Plan/Feasibility Review；
4. 验证两个真实 child 被原子创建；
5. 完成依赖推进、child Review、父 Integrate/Record；
6. `tc doctor` 通过；
7. 验证 single L3 路径；
8. 验证 unfinished child 阻止父取消。

最后至少在一个真实 Codex 或 Claude 宿主会话验证 Entry 从 root parent 恢复到正确 child。若真实宿主测试无法运行，必须把迁移/狗粮化门标记为 blocked，不能用构造 breadcrumb 代替。

## 9. Review gates

每个 checkpoint 完成后检查：

- 是否出现第二个写入口或第二套 parent status 推导；
- 是否把 scope/coordination 偷换成硬依赖；
- 是否伪造 child planning Attempt；
- 是否允许 Level 3 child 或递归树；
- 是否出现部分 child materialization；
- 是否自动 cascade cancel 或声称停止宿主 subagent；
- 是否恢复 Stop Hook、后台 scheduler 或隐藏 fallback；
- 是否在 CLI、Watch、doctor、fixtures 和 specs 之间产生合同漂移。

## 10. Rollback points

- Checkpoint A 的 migration 只追加表；代码回滚不会删除用户数据。旧二进制无法理解 v2 relations，因此回滚前不得创建正式 v2 数据。
- Checkpoint C 是最大风险点：在 transaction test 和 failure injection 全绿前，不继续接入 CLI/Watch。
- Checkpoint D 的 parent projector 必须保留 L1/L2 和 old L3 v1 分支；发现状态回归时回滚 relation-aware projection，不修改历史 facts。
- 不运行破坏性数据库降级。需要放弃方案时保留 migration 和历史数据，使用新 migration/代码前向修正。

## 11. Completion gate

只有以下条件全部满足才能报告完成：

- PRD AC1–AC14 全部有自动测试或真实样本证据；
- targeted tests、`pnpm check`、`pnpm smoke:watch`、`git diff --check` 全绿；
- 至少一个公开 CLI modules 样本和一个 single 样本可重放；
- real-host Entry 恢复样本已验证，或明确阻塞迁移门；
- docs/specs/fixtures 不再声称旧单 execute child 模型；
- diff review 未发现重复真相源、隐式调度、伪 Attempt、silent fallback 或历史删除。

## 12. Final evidence（2026-08-17）

- `pnpm check`：54 个测试文件、396 个测试通过；typecheck、lint、format check、
  build 全绿。
- `pnpm smoke:watch`：desktop/mobile 共 6 个 Playwright smoke 通过。沙箱内监听
  `127.0.0.1` 会得到 `EPERM`，在获准的本机监听环境重跑后全绿。
- 公开 CLI smoke：modules/single、两 child、dependency、waiting/resume、Review、
  父取消拒绝、Integrate/Record 和 `tc doctor` 全部通过，输出
  `public-cli-smoke-ok`。
- `git diff --check` 与 `task.py validate` 通过。
- 最终差异审查补齐 direct child `dependsOn` 强门、Integrate 重复 child 引用拒绝、
  parent/child CLI 合同展示和 Projector 请求内缓存；均有回归测试。
- Codex 0.147.0 真实公共 Entry 测试通过；Claude 现场成功证据仍缺，因此
  Trellis → Taskcraft 双宿主迁移门继续保持 `blocked`，没有被误报为已通过。
