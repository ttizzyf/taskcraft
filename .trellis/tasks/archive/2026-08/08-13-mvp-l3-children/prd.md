# L3 multi-child decision

## Goal

解决 L3 Plan 可声明多 child 但生产图仅单 execute-1 的合同偏差：做出产品决定
（物化 per-child 分支或收窄单 execute），同步合同、实现、fixtures 与文档。

## Requirements

### REQ-01. 现状复核

复核当前实现：L3 图单 execute-1、plan result schema 声明 children[]、
l3-two-children fixture 为预制模拟；对照 lifecycle.md §5 "execute [required
per child]" 与 cli.md §4 L3 示例，记录偏差证据。

### REQ-02. 产品决定（二选一）

向用户提交并记录决定：
- (a) 物化 per-child execute/review 分支：动态物化 N 个 execute/review
  节点（children/validationOwners/childrenResults 一一对应校验），公开 CLI
  生成真实双分支样本，Integrate 前全部分支 Review 通过。
- (b) 收窄首版为单 execute：同步 lifecycle.md §5 与 cli.md（移除 per-child
  声称或标记 deferred），plan children 仅作声明/信息，l3-two-children
  fixture 与文档同步改写。

### REQ-03. 决定后实施

按决定同步：生命周期图实现、reducer 校验、fixtures、测试、specs
（lifecycle.md/cli.md）、handoff/样本文档。fixture 不得作为唯一证据
（决定 (a) 需公开 CLI 双分支样本；(b) 需删除多分支声称）。

## Acceptance Criteria

- [ ] 决定已记录（含理由与替代方案成本）。
- [ ] 合同（lifecycle.md/cli.md）与实现、fixtures、测试、文档一致。
- [ ] (a) 时：真实双分支公开 CLI 样本 + Integrate 门；(b) 时：无多分支
      声称残留。
- [ ] `pnpm check` 全绿。

## Notes

- 决定先于实现（本任务先出决定，实现可并入本任务或 F）。
- 推荐 (b)：物化分支引入动态图编译复杂度，超出 MVP 收窄目标。
