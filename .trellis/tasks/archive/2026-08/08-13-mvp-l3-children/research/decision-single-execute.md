# 决定记录：L3 收窄首版为单 execute（选项 b）

> 2026-08-13。产品决定已定：**(b) 收窄首版为单 execute**，本文件记录
> 理由、替代方案成本与同步范围，供 check agent 与父任务复核。

## 偏差证据（复核结论）

1. `development/specs/lifecycle.md` §5 L3 最低合同写 "execute [required per
   child]"，而 `src/core/lifecycle/l3.ts` 生产图只物化单一 `execute-1` 节点。
2. `development/contracts/fixtures/l3-two-children.fixture.json` 的"两个分支"
   是单图内两个 execute attempt 的预制模拟（execute-1 attempt 1/2），生产
   图并无 per-child 分支。
3. `L3_PLAN_RESULT_SCHEMA` 的 `children` 数组与 `validationOwners`、
   `L3_INTEGRATE_RESULT_SCHEMA` 的 `childrenResults` 之间没有一一对应校验，
   且未对 children 数量设限——合同声明与实现能力不一致。

## 决定：(b) 收窄首版为单 execute

### 理由

- per-child 物化（选项 a）要求按 plan children 动态生成
  execute-N/review-N 节点、reducer 按 children 校验一一对应、integrate
  聚合多分支门——引入动态图编译复杂度，超出 MVP 收窄目标。
- 首版产品事实是"单 execute-1 + 单 review-execute-1 + integrate 门"，
  合同声明与之对齐成本最低（仅限 children ≤ 1 + 文档标注）。

### 替代方案 (a) 的成本（未采纳）

| 项 | 成本 |
| --- | --- |
| 动态节点物化 | reducer 需在 plan 完成时按 children 生成 execute-N/review-N 节点，图定义从静态变为按 attempt 推导 |
| 一一对应校验 | plan result 与 execute/review attempt 归属需新增引用校验路径 |
| Integrate 聚合 | integrate 门需等待全部 review 分支，projector next 推导复杂化 |
| 公开 CLI 样本 | 需要真实双分支可回放样本与对应 CLI 集成测试 |

## 同步范围（已实施）

- `src/core/lifecycle/l3.ts`：children/validationOwners/childrenResults 各
  加 `maxItems: 1`，注释说明首版单 execute、per-child 物化延后。
- `development/specs/lifecycle.md` §5：execute 标注首版单 execute，plan
  children 为信息性声明（上限一个 child）；delivery review 去掉 "per
  execute" 措辞；增注首版只物化单 execute；integrate 行由 "required when
  graph has multiple delivery branches" 改为无条件 "required"（单 execute
  下该条件永不成立，而实现始终物化 required integrate 门）。
- `development/specs/cli.md`：L3 示例本就单 execute-1，无多 child 声称，
  无需改动（不加新命令）。
- fixtures：删除 `l3-two-children.fixture.json`，新增
  `l3-single-child.fixture.json`（单 child + 一个 delivery 分支，integrate
  门演示保留）；其余 7 个 l3-* fixture 的 plan children/validationOwners
  同步为单 child，l3-pass 的 execute 摘要与 childrenResults 同步。
- 测试：`tests/core/l3-utils.ts`、`tests/cli/l3-helpers.ts` 结果样例收窄
  单 child；`tests/core/projector.l3-fixtures.test.ts` 的
  l3-two-children 用例改为 l3-single-child（integrate 门断言不变，删除
  "两个分支"断言）。
- `development/l3-sample.md`：plan/execute/integrate 结果声明收窄单 child。

## 残留边界

- fixture 直接插库不走 schema 校验，但所有 l3-* fixture 已与单 child
  合同对齐，不保留多分支声称。
- integrate 的 `childrenResults` 保留数组结构（合同字段），仅上限 1；
  per-child 物化恢复时移除 maxItems 即可，无需改表。
