# Spec 交付、收口与诊断实现合同

## 1. Scope / Trigger

修改 Node Brief、Review start、Record schema/obligation、`spec_impact_results`、
`task show`、Watch Task Detail 或 doctor 的 Spec 检查时适用。Registry 文件安全由
[`spec-registry-contract.md`](spec-registry-contract.md) 负责，revision binding 与
L3 继承由 [`spec-lifecycle-contract.md`](spec-lifecycle-contract.md) 负责。

## 2. Signatures

```ts
interface NodeBriefSpec {
  id: string;
  kind: "engineering" | "domain";
  duty: "required" | "recommended";
  path: string;
  digest: string;
  drift: { status: "current" | "stale"; reasons: string[] } | null;
}

type SpecImpactResult =
  | { outcome: "none"; reason: string }
  | { outcome: "updated"; updates: SpecUpdate[] }
  | { outcome: "candidate"; candidates: SpecCandidate[] };

loadSpecDeliveryView(projectDir, database, taskId, revision): SpecDeliveryView;
```

## 3. Contracts

- `src/core/reducer/node-brief.ts` 从 exact SQLite revision/node binding 构建 DTO；命令
  边界只附加 Registry drift。Codex/Claude Adapter 调用同一个纯 renderer，不读文件。
- Review Brief 使用 Review node binding，并包含 purpose、被审核 attempt/node、result
  和该 attempt evidence。required drift 在 Review attempt 写入前失败。
- `review changes` 原子创建的 successor Execute/Plan attempt 必须返回它自己的 Node
  Brief；命令边界把创建前已经检查过的同一份 Registry drift 附加到该 Brief，不能在
  reducer 或 renderer 中二次读取 Registry。
- `tc-l1/3`、`tc-l2/3`、`tc-l3/4`、`tc-l3-child/3` 的 Record schema 要求
  `specImpact` 和 required `spec-impact-recorded`；旧 compiler 使用 SQLite 中保存的
  exact schema/obligations，不回填。
- `none` 要求非空理由。`updated` 由 command service 验证 active current Registry
  snapshot，Reducer 再验证 submitted/resolved 语义等价和 Task-owned evidence；等价
  比较不受 object key 或 update 顺序影响，但严格拒绝未声明字段与重复 Spec id。
  `updated` 只能引用本 Task 的 `validation | test | artifact` evidence，`note` 不能作为
  Spec 已更新的证明。已经写入的历史 Impact 只校验其记录时保存的 resolved snapshot，
  Registry 后续合法更新不会反向破坏历史事实。
  `candidate` 不读取或写入 Registry；domain candidate 必须保留 ownerDecision。
- Record attempt、note evidence、Impact row 和 obligation 在同一 reducer 事务写入；
  任一步失败整笔回滚。
- `src/spec/delivery.ts` 是 `task show` 与 Watch 的共享 DTO。Watch 只渲染 Registry
  issue、binding drift 和 Impact，不推导状态或语义。
- doctor 始终只读：命令边界检查 Registry；Store 检查 binding current drift、来源
  provenance、orphan、Impact schema/evidence、成功 Record attempt、Record result、
  required obligation 和 compiler/schema 代际的一致性。L3 inherited provenance 必须
  精确指向同一 parent execution source、module requirement 和已成功的 source Plan
  attempt，不能只检查引用存在。

## 4. Validation Matrix

| 条件                                                                      | 结果                                                   |
| ------------------------------------------------------------------------- | ------------------------------------------------------ |
| required Registry/path/digest 不可用                                      | `TC_SPEC_BINDING_STALE`，不创建 Execute/Review attempt |
| recommended 漂移                                                          | Brief/CLI/Watch 显示 stale，不阻断                     |
| `none` 空 reason 或 candidate 缺 ownerDecision                            | schema 失败，无 Record facts                           |
| `updated` 非 current snapshot、foreign/`note` evidence 或语义不等价        | `TC_SPEC_IMPACT_INVALID`，整笔回滚                     |
| Impact insert/obligation 失败                                             | Record attempt、evidence、Impact 和 obligation 全回滚  |
| 旧 compiler 无 Impact                                                     | 合法，可按 stored schema 完成                          |
| Registry/binding/Impact/result/obligation/schema 关系损坏                  | doctor 非零，Registry 与 DB bytes 不变                 |

## 5. Good / Base / Bad Cases

- Good：新 compiler 的 Record 在一次事务内完成 attempt、Record evidence、typed
  Impact 和 `spec-impact-recorded` obligation；`updated` 引用本 Task 的 test evidence
  与当前 active Registry snapshot。
- Base：旧 compiler 没有 Spec Impact obligation，仍按 stored Record schema 完成；
  当前 Registry 后续更新不会反向把历史 `updated` Impact 判为损坏。
- Bad：`review changes` 创建 successor Attempt 却不返回它自己的 Brief，或再次读取
  Registry 得到另一份 drift；必须返回 exact successor Brief，并附加创建前已检查的
  同一份 drift。
- Bad：用 `note` evidence 证明 Spec 已更新、按 JSON key/数组顺序比较 Impact，或让
  Watch/Adapter 自行解析 Registry；这些路径必须由 schema、Reducer 或共享 DTO 拒绝。

## 6. Tests Required

- `tests/core/reducer.spec-impact.test.ts`、`reducer.spec-compatibility.test.ts`。
- `tests/core/reducer.run.test.ts`、`reducer.spec-bindings.test.ts`、
  `tests/adapters/node-brief.test.ts`。
- `tests/spec/delivery.test.ts`、`tests/cli/spec-impact.test.ts`、
  `tests/cli/spec-lifecycle.test.ts`、`tests/core/doctor.test.ts`。
- `tests/watch/frontend-render.test.ts`、`frontend.spec.ts`；桌面/移动均检查 Specs
  区块、无重叠和无横向溢出。

## 7. Wrong vs Correct

Wrong：Adapter/前端自行读取 Registry、candidate 自动写 Spec、给旧 revision 动态套用
新 Record schema，或先完成 Record 再另起事务写 Impact。

Correct：文件解析停在 command/service 边界；Reducer 只验证 resolved DTO 并原子写
facts；所有显示层消费同一个 immutable query DTO。
