# Design: L3 multi-child decision

## 偏差证据（复核清单）

1. lifecycle.md §5 L3："execute [required per child]" vs l3.ts 单 execute-1。
2. l3-two-children.fixture.json 的"两分支"是单图内两个 attempt 的模拟。
3. plan schema children[] 与 validateOwners/childrenResults 无一一对应校验。

## 决定选项成本

| 选项 | 实现成本 | 合同改动 | 风险 |
| --- | --- | --- | --- |
| (a) 物化 per-child | 动态节点物化（reducer 按 children 生成 execute-N/review-N）、Integrate 聚合、公开 CLI 双分支样本 | lifecycle.md 保持 | 动态图复杂度，超出 MVP 收窄目标 |
| (b) 收窄单 execute | 校验 children 长度 ≤1（或仅声明）、删除多分支声称 | lifecycle.md/cli.md 改 | 低 |

## 实施要点（依决定）

(b) 路径：
- l3.ts plan schema：children 保留为声明（maxItems 1 或文档注明信息性）；
  validationOwners/childrenResults 同步限制。
- lifecycle.md §5 增注："首版 L3 单 execute；per-child 物化延后"。
- l3-two-children fixture 改写为单 child 或标注模拟；测试断言更新。
- handoff/l3-sample 文档同步。

(a) 路径（若选）：动态物化 + 一一对应校验 + Integrate 聚合 + CLI 样本。

## 记录

决定写入本任务 research/ 或 prd 附录（理由、替代、成本）。
