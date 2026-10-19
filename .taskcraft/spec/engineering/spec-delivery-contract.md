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
}

type SpecImpactResult =
  | { outcome: "none"; reason: string }
  | { outcome: "updated"; updates: SpecUpdate[] }
  | { outcome: "candidate"; candidates: SpecCandidate[] };

loadSpecDeliveryView(database, taskId, revision): SpecDeliveryView;
```

## 3. Contracts

- `src/core/node-brief-query.ts` 从 exact SQLite revision/node binding 构建 DTO，
  内容是`{id, kind, duty, path}`。Codex/Claude Adapter 调用同一个纯 renderer，不读文件。
- `task show` 返回可空 `nodeBrief`，从 Projector 的当前 running node 恢复已领取卡，
  与 `run` 共用构造器；Review context 从持久化 link 读取。查询不创建 attempt、
  不改变 revision/events；无已领取节点返回 null，L3 child 读取自身任务卡。
  查询只读同一份 SpecDeliveryView，不读取 Registry，也不执行任何写入 gate。
- 结果校验使用当前 revision 保存的 Schema 与共享缓存 validator；错误沿用既有
  信封，`problem` 提供字段路径/约束，`remediation` 指向具体 task show 命令，
  不回显提交值，失败整笔回滚；doctor 的布尔校验也复用该 validator。
- Review Brief 使用 Review node binding，并包含 purpose、被审核 attempt/node、result
  和该 attempt evidence。Spec 正文是否被编辑与 Review 无关。
- `review changes` 原子创建的 successor Execute/Plan attempt 必须返回它自己的 Node
  Brief；Brief 只由 Store 事实构建，reducer 与 renderer 都不读 Registry。
- `tc-l1/3`、`tc-l2/3`、`tc-l3/4`、`tc-l3-child/3` 的 Record schema 要求
  `specImpact` 和 required `spec-impact-recorded`；旧 compiler 使用 SQLite 中保存的
  exact schema/obligations，不回填。
- `none` 要求非空理由。`updated` 由 command service 验证每个 specId/path 是 active
  current Registry 条目，Reducer 再验证 submitted/resolved 语义等价和 Task-owned
  evidence；等价比较不受 object key 或 update 顺序影响，但严格拒绝未声明字段与重复
  Spec id。`updated` 不记录正文哈希，因此 Registry 后续合法更新不会反向破坏历史
  事实。
  `updated` 只能引用本 Task 的 `validation | test | artifact` evidence，`note` 不能作为
  Spec 已更新的证明。已经写入的历史 Impact 只按自身存储形态校验，不拿今天的 Registry
  回判。
  `candidate` 不读取或写入 Registry；domain candidate 必须保留 ownerDecision。
- Record attempt、note evidence、Impact row 和 obligation 在同一 reducer 事务写入；
  任一步失败整笔回滚。
- Spec Impact 按 Record attempt 保存，完成义务按 task/revision/node/obligation 唯一
  保存。返工再次内嵌 Record 时，各 attempt 的 Impact/result 都须校验；节点义务
  可保留首次满足它的证据，不得要求同一条义务同时引用每次 Record。doctor 必须
  验证该证据属于同 task/revision 的成功 Record，且有对应 Impact，不能仅因某个
  其他 attempt 存在 Impact 就放行。
- `src/spec/delivery.ts` 是 `task show` 与 Watch 的共享 DTO，是**纯 Store 投影**：只
  含已记录的 binding 与 Impact。Watch 只渲染它，不推导状态或语义。已结束任务与未
  结束任务的 binding 一视同仁——它们都是历史事实。
- doctor 始终只读，且 Registry 与 Store 分开检查：命令边界单独报告 Registry 是否
  可加载、是否合法，**不与任何 Store 事实比对**；Store 检查 binding 来源 provenance、
  orphan、Impact schema/evidence、成功 Record attempt、Record result、required
  obligation 和 compiler/schema 代际的一致性。L3 inherited provenance 必须
  精确指向同一 parent execution source、module requirement 和已成功的 source Plan
  attempt，不能只检查引用存在。

## 4. Validation Matrix

| 条件                                                                      | 结果                                                   |
| ------------------------------------------------------------------------- | ------------------------------------------------------ |
| 已绑定 Spec 的正文被编辑或删除                                            | 不阻断；binding 不含正文哈希，无漂移语义               |
| Registry 不可加载或非法                                                   | doctor 的 `spec-registry` 检查失败；不影响 attempt 创建 |
| `none` 空 reason 或 candidate 缺 ownerDecision                            | schema 失败，无 Record facts                           |
| `updated` 非 active current 条目、foreign/`note` evidence 或语义不等价     | `TC_SPEC_IMPACT_INVALID`，整笔回滚                     |
| Impact insert/obligation 失败                                             | Record attempt、evidence、Impact 和 obligation 全回滚  |
| 旧 compiler 无 Impact                                                     | 合法，可按 stored schema 完成                          |
| 已领取节点的只读恢复                                                      | 返回同源卡，不重新领取或写事实                         |
| 结果缺字段、类型错误或含额外字段                                           | `TC_LIFECYCLE_RESULT_INVALID`，字段路径/约束及具体取卡命令，无部分写入 |
| 返工产生多个合法 Record，节点义务保留首次有效证据                           | doctor 通过；逐 attempt 校验 Impact，按节点校验义务     |
| Registry 非法或 binding/Impact/result/obligation/schema 关系损坏            | doctor 非零，Registry 与 DB bytes 不变                 |

## 5. Good / Base / Bad Cases

- Good：新 compiler 的 Record 在一次事务内完成 attempt、Record evidence、typed
  Impact 和 `spec-impact-recorded` obligation；`updated` 引用本 Task 的 test evidence
  与当前 active Registry 条目。
- Base：旧 compiler 没有 Spec Impact obligation，仍按 stored Record schema 完成；
  当前 Registry 后续更新不会反向把历史 `updated` Impact 判为损坏。
- Good：冷启动查询已领取 Review 得到正确的被审 attempt 与 evidence；查询前后
  SQLite 内容相同。无已领取节点时 `nodeBrief: null`，按 `next` 正常领取。
- Bad：`review changes` 创建 successor Attempt 却不返回它自己的 Brief，或让显示层
  自行读取 Registry；必须返回 exact successor Brief，且 Brief 只由 Store 事实构建。
- Bad：用 `note` evidence 证明 Spec 已更新、按 JSON key/数组顺序比较 Impact，或让
  Watch/Adapter 自行解析 Registry；这些路径必须由 schema、Reducer 或共享 DTO 拒绝。

## 6. Tests Required

- `tests/core/reducer.spec-impact.test.ts`、`reducer.spec-compatibility.test.ts`。
- `tests/core/node-brief-query.test.ts`、`lifecycle-result.test.ts`：重复取卡无写入、
  Review successor/feasibility、L3 parent/child、字段诊断与历史 Schema。
- `tests/core/reducer.run.test.ts`、`reducer.spec-bindings.test.ts`、
  `tests/adapters/node-brief.test.ts`。
- `tests/spec/delivery.test.ts`、`tests/cli/spec-impact.test.ts`、
  `tests/cli/spec-lifecycle.test.ts`、`tests/core/doctor.test.ts`。
- `tests/watch/frontend-render.test.ts`、`frontend.spec.ts`；桌面/移动均检查 Specs
  区块、无重叠和无横向溢出。

## 7. Wrong vs Correct

Wrong：Adapter/前端自行读取 Registry、candidate 自动写 Spec、给旧 revision 动态套用
新 Record schema，先完成 Record 再另起事务写 Impact，或冷启动调用 `review start`
来获取已经开始的 Review 卡。

Correct：文件解析停在 command/service 边界；Reducer 只验证 resolved DTO 并原子写
facts；所有显示层消费同一个 immutable query DTO。
