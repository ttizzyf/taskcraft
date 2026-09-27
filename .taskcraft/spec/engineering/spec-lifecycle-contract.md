# Spec 生命周期绑定实现合同

## 1. Scope / Trigger

修改 `lifecycle_spec_bindings`、`spec_impact_results`、L1/L2/L3 compiler、
L2 Frame/L3 accepted Plan、child reuse、Execute/Review drift gate 或
`tc task spec refresh` 时适用本合同。Registry 的文件安全和摘要规则仍由
[`spec-registry-contract.md`](spec-registry-contract.md) 负责；Node Brief、Watch、
doctor 和 Spec Impact 结果 Schema 由 delivery 层负责。

## 2. Signatures

命令边界把 `{id,duty}` 选择解析成不含正文的 snapshot：

```ts
interface ResolvedSpecBinding {
  specId: string;
  kind: "engineering" | "domain";
  path: string;
  digest: string;
  duty: "required" | "recommended";
}

getLifecycleSpecBindings(db, taskId, revision?, nodeId?)
getSpecImpactResults(db, taskId, revision?)
insertLifecycleSpecBindings(db, input)
insertSpecImpactResult(db, input)
```

Reducer 只接收 `ResolvedSpecBinding[]`，不读取 Registry 或项目文件。绑定身份是
`task/revision/node/spec`；source 是 `task_create | frame | accepted_plan |
inherited_plan | refresh`，并保留 Frame/parent Plan attempt provenance。

## 3. Contracts

- 当前 compiler 是 `tc-l1/3`、`tc-l2/3`、`tc-l3/4` 和
  `tc-l3-child/3`；上一代 `tc-l1/2`、`tc-l2/2`、`tc-l3/3` 和
  `tc-l3-child/2` 已支持 binding，但没有 Spec Impact。所有旧 stored schema 由 exact node 的
  `output_schema_json` 校验；旧 `tc-l3/2` accepted Plan 继续生成 `/2` execution
  revision 和 `tc-l3-child/1` child，不被新 schema 反向升级。
- L1 task-create binding 指向 Execute/Record；L2 task-create 只指向 Frame；L3
  task-create 指向 Frame/Plan/Feasibility Review。空选择合法，不制造 placeholder。
- 新 L2 Frame result 必须有 `specBindings`；命令解析 active Registry ids，Reducer
  在结束 Frame 的同一事务把 snapshot 写到 Execute/Delivery Review/Record。
- 新 L3 Plan 每个 module 有 `specBindings`，parent 有 `executionSpecs`。Feasibility
  pass 在同一事务解析/核对 selection，写 parent execution binding、真实 child
  execution-only binding 和 inherited Plan provenance；失败回滚 review evidence、
  execution revision、children 与全部 relation/binding。
- child 没有假 Frame/Plan Attempt。reuse 除原 task 合同外还要求当前 child revision
  的 Spec `id/kind/path/digest/duty` snapshot 等价；同一 child 各目标节点保存的 snapshot
  也必须一致。reuse 不改 child lifecycle、binding 或原 provenance。

### Drift And Refresh

- 文件系统 revalidation 只发生在 command/service 边界。创建 Execute 或 Review
  attempt 前，required 的 missing/deprecated/kind/path/digest drift 返回
  `TC_SPEC_BINDING_STALE`，且不写 Attempt；recommended drift 不阻断。
- `tc task spec refresh <task> --reason <text>` 解析当前已确认 id/duty 后创建新
  lifecycle revision，并以 `source=refresh` 写新 snapshot；旧 binding 不更新或删除。
- L1/L2 refresh 重新进入自身首节点。L3 root 重新进入 planning graph；当前 required
  inherited child 发起 refresh 时路由到 root L3，并在新 parent revision 追加旧 child
  的 `not_required` membership。
- refresh 不 supersede/cancel 旧 Attempt，不删除 Evidence，也不停止宿主运行。

## 4. Validation & Error Matrix

| Condition                             | Result                                               |
| ------------------------------------- | ---------------------------------------------------- |
| binding update/delete                 | SQLite abort：`Spec bindings are append-only`        |
| Impact update/delete                  | SQLite abort：`Spec Impact results are append-only`  |
| 非 Frame/Plan source attempt          | `TC_SPEC_BINDING_INVALID` 或 trigger abort，事务回滚 |
| selection 与 resolved snapshot 不等价 | `TC_SPEC_BINDING_INVALID`，无部分写入                |
| reuse child Spec set 不等价           | `TC_L3_PLAN_INVALID`，accepted Plan 全事务回滚       |
| required Execute/Review drift         | `TC_SPEC_BINDING_STALE`，不创建 Attempt              |
| historical revision 无 binding        | 合法；可读、可投影、按 stored schema 完成            |

## 5. Good / Base / Bad Cases

- Good：新 L3 modules Plan 在一次 Feasibility Review 事务中创建 parent execution
  revision、真实 child、完整 Spec snapshot 和 parent Plan provenance；任一写入失败时
  Review evidence 与全部新事实一起回滚。
- Base：新任务显式选择空 Spec 集，binding 表保持为空；旧 compiler revision 同样
  没有 binding，仍按自身 stored schema 正常执行和完成。
- Bad：只比较 child 的 Spec id/duty 后复用 digest 已漂移的历史 child；必须比较
  `id/kind/path/digest/duty` 完整 snapshot，并保持历史 child 不变。
- Bad：命令先检查 revision N 的 required binding，Reducer 却在 revision N+1 创建
  Attempt；漂移检查结果必须携带已检查 task revision，并由 Reducer CAS 拒绝竞态。

## 6. Tests Required

- `tests/store/migrations.test.ts`、`spec-facts.test.ts`：0003、完整 SQL、FK、immutable。
- `tests/core/reducer.spec-bindings.test.ts`、`reducer.spec-refresh.test.ts`、
  `reducer.spec-compatibility.test.ts`：L1/L2/L3 single/modules、provenance、rollback、
  完整 reuse snapshot、refresh、child→root routing 与旧 compiler compatibility。
- `tests/cli/spec-lifecycle.test.ts`、`spec-lifecycle-attempt-gates.test.ts`：公开 task
  new、L2 Frame、L3 Plan、required / recommended drift、successor Attempt gate 和
  refresh。
- 修改本边界后运行 `tests/store`、相关 reducer/L3 tests、typecheck、lint、format
  check 和 build；CLI tests 必须使用最新 build。

## 7. Wrong vs Correct

### Wrong

```ts
// Reducer 相信调用方传入任意 refresh snapshot，或 reuse 只比较 id/duty。
taskSpecRefresh(db, taskId, { resolvedSpecBindings: callerBindings, reason });
sameSelectionIds(existingChildBindings, proposedBindings);
```

这会绕过当前已确认合同，并让漂移后的历史 child 错误满足新 parent gate。

### Correct

```ts
// 事务内重算当前选择集并校验完整 snapshot；Attempt 写入携带检查时的 revision CAS。
assertResolvedSpecSelections(currentSelections, callerBindings, "Spec refresh");
assertCompleteBindingSnapshotEqual(existingChildBindings, proposedBindings);
run(database, taskId, nodeId, { expectedRevision: checkedTaskRevision });
```

命令边界负责文件解析，Reducer 负责事务内合同/CAS，二者缺一不可。
