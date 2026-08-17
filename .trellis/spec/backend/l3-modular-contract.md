# L3 模块化跨层实现合同

## 1. Scope / Trigger

修改下列任一边界时必须使用本合同：L3 Frame/Plan schema、Feasibility
`review pass`、父子 relation migration/query、parent Projector、Integrate 引用、
replan/cancel、Entry active task 选择、CLI/Watch L3 DTO 或 doctor。

权威产品行为见 `development/specs/lifecycle.md` §5/§9、`architecture.md` §3–§8、
`cli.md` §4–§7 和 ADR 0010。本文件只记录已由源码与测试证明的实现合同。

## 2. Signatures

```ts
interface L3ModuleProposal {
  key: string;
  reuseTaskId?: string;
  title: string;
  level: 1 | 2;
  reason: string;
  objective: string;
  scope: string[];
  acceptance: string[];
  nonGoals: string[];
  covers: string[];
  reviewFocus: string[];
}

interface Projection {
  runnableWorkItems: RunnableWorkItem[];
  children: ChildProjection[];
  anchors: AcceptanceAnchorRow[];
  coverage: AnchorCoverageRow[];
  dependencies: TaskDependencyRow[];
  validations: ValidationAssignmentRow[];
  executionSource: ExecutionSourceRow | null;
  inheritedPlanning: InheritedPlanningRow | null;
}
```

Definition tables added by `migrations/0002_l3_modular_tasks.sql`:

```text
lifecycle_acceptance_anchors
lifecycle_execution_sources
lifecycle_child_requirements
lifecycle_anchor_coverage
lifecycle_task_dependencies
lifecycle_validation_assignments
lifecycle_inherited_planning
```

Public commands remain the existing command surface:

```text
tc review pass <parent> ...
tc review replan <parent-or-inherited-child> ...
tc task show|next <parent> --json
tc task cancel <parent> ...
tc doctor
```

## 3. Contracts

- `tc-l3/2` task creation only materializes the planning graph
  `frame-1 -> plan-1 -> review-plan-1`.
- Feasibility pass runs `acceptL3Plan()` inside the review transaction. Modules
  mode atomically creates the parent execution revision, all new child rows,
  execution-only child graphs and normalized relations. Single mode creates no
  child and compiles the parent execute path.
- Child task rows copy title/level/objective/scope/acceptance/nonGoals from the
  accepted proposal. `scope` is advisory; it is not a path permission check.
- Child level is L1/L2 only and `parent_task_id` depth is one. The child has no
  fake Frame/Plan Attempt; `lifecycle_inherited_planning` points to the parent
  Plan attempt.
- Reuse is explicit. `reuseTaskId` must name a historical child of the same
  parent and its level/title/objective/scope/acceptance/nonGoals must exactly
  match. Reuse inserts only the new required membership; it does not rewrite
  the child lifecycle or provenance.
- Parent runnable is gated only by child lifecycle plus explicit
  `lifecycle_task_dependencies`. Shared scope/anchors/validations never become
  inferred locks.
- A current required child projects its parent revision's explicit dependencies
  before exposing a runnable node. Until every predecessor is `done`, the child
  has no `next`/`runnableWorkItems`, and a direct `tc run <child>` is rejected;
  the parent aggregate consumes that same child projection instead of deriving
  a second dependency gate.
- Integrate requires every current required child exactly once, at its current
  task revision, with evidence owned by that child.
- Replan appends `not_required` memberships and keeps old facts. An inherited
  L2 child review replan routes to the root L3 planning revision. Taskcraft
  does not cancel siblings or stop host runs.
- Entry chooses one active root (`parentTaskId === null`). A root parent and an
  active child are a valid pair, not “multiple active task” ambiguity.
- Watch and CLI consume the same Projector fields; the frontend does not derive
  dependencies, completion gates or parent status.

## 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| modules fewer than two; single lacks attempted split | `TC_L3_PLAN_INVALID`, full review transaction rollback |
| missing/unknown anchor coverage, unknown validation owner, dependency cycle | `TC_L3_PLAN_INVALID`, no child/revision/evidence partial writes |
| Level 3 module | Plan result schema rejects with `TC_LIFECYCLE_RESULT_INVALID` |
| `reuseTaskId` is foreign, duplicated or contract-mismatched | `TC_L3_PLAN_INVALID`, historical child unchanged |
| Integrate omits/duplicates child or uses stale revision/foreign evidence | `TC_LIFECYCLE_RESULT_INVALID`, Integrate attempt remains open |
| parent has unfinished required children at cancel | `TC_TASK_CHILDREN_UNRESOLVED`, no cascade |
| direct `tc run <child>` while an explicit predecessor is unfinished | `TC_ATTEMPT_REF_INVALID`, no Attempt is created |
| modules execution has no required children or hierarchy cycle | `TC_STORE_PROJECTION_FAILED` |
| nested/L3 child, uncovered required anchor, dependency cycle, missing provenance | doctor `l3-relations` fails with `TC_STORE_INTEGRITY_FAILED` |
| Review 显式引用 failed/blocked/stale predecessor | `TC_REVIEW_REF_INVALID`，不得创建 Review attempt/link |

## 5. Good / Base / Bad Cases

- Good：两个 modules，B 显式 dependsOn A；A done 后 B runnable，children done 后
  parent Integrate runnable，CLI/Watch 显示同一集合。
- Base：经 Feasibility Review 接受的 `single`，记录 attempted split，不创建 wrapper
  child，父任务执行自己的 execute/review/integrate/record。
- Bad：把 scope 重叠当成硬依赖、为 child 伪造 completed Frame/Plan Attempt、
  replan 删除旧 child、或 Entry 直接锚定 active child。

## 6. Tests Required

- `tests/store/migrations.test.ts`：0001→0002、外键、append-only triggers、完整 SQL。
- `tests/core/reducer.l3-plan.test.ts`：Plan 语义、原子回滚、waiting/resume、
  child→parent replan、reuse/new/not_required、合同不匹配。
- `tests/core/projector.l3.test.ts`：真实 children、dependency、provenance、Integrate gate、single。
- `tests/core/reducer.l3-integrate.test.ts`：Integrate child 引用必须完整且不得重复。
- `tests/core/doctor.test.ts`：L3 child、coverage deletion、dependency cycle、provenance deletion。
- `tests/core/reducer.review-start.test.ts`：拒绝不是最新 finished/success 的显式 reviewed attempt。
- `tests/hooks/entry.test.ts`：parent 与 active child 共存时仍注入 root breadcrumb，
  next 指向 child。
- `tests/cli/l3.test.ts`：build 后通过公开 CLI 覆盖 modules/single/replan/done。
- `tests/watch/server.test.ts`、`frontend-render.test.ts`：API 与 UI 只消费共享 DTO。

CLI 测试调用 `dist/cli.js`，所以必须先 `pnpm build`；未 build 的通过结果不是有效证据。

## 7. Wrong vs Correct

### Wrong

```ts
const active = listTasks(db).map((task) => project(db, task.id));
// parent 与 active child 同时出现，被误判为“多个 active”。
```

```ts
if (left.scope overlaps right.scope) block(right);
// 把 coordination signal 偷换成调度锁。
```

### Correct

```ts
const activeRoots = listTasks(db)
  .filter((task) => task.parentTaskId === null)
  .map((task) => project(db, task.id))
  .filter((projection) => projection.status === "active");
```

```ts
const runnable = dependencies.every(
  (edge) => childStatus.get(edge.dependsOnTaskId) === "done",
);
// scope/anchor/validation 仅在 DTO 中提示协调。
```
