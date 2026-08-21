# Spec 生命周期绑定与继承

## Goal

把已确认的 Spec 引用变成 revision/node scoped、append-only 的 Taskcraft facts，并
覆盖 L1、L2、L3 single/modules、child inheritance、reuse、漂移和显式刷新。

## Requirements

- additive migration 创建规范化 binding/impact facts 和不可变约束，不回填旧 Task。
- task new 接受 resolved initial bindings；L2 Frame 形成下游绑定；L3 accepted Plan
  原子写 parent/module bindings，child 继承且不重复规划。
- Registry id/path/kind/digest 在命令边界解析，reducer 只接收结构化值并事务校验。
- required/recommended 分开；required 漂移阻止新 Execute/Review attempt，recommended
  漂移只披露。
- `tc task spec refresh` 创建新 lifecycle revision；模块化 L3/child 路径回到 root Plan，
  保留旧 child/attempt/evidence，不取消宿主运行。
- reusable child 必须同时满足现有合同与 Spec set 等价。

## Acceptance Criteria

- [ ] migration 0001->0002->0003、全新建库、checksum 和完整 SQL 合同均通过。
- [ ] 旧 revision 无 binding 时仍可读、可完成且 doctor 不误报。
- [ ] L1/L2/L3 single/modules 的 binding 均落在正确 revision/node。
- [ ] child binding 有 parent Plan provenance；reuse mismatch 和任意原子失败不留部分行。
- [ ] required drift 与 refresh/replan 有稳定错误、事件、CAS 和回归测试。

## Dependency

依赖 `tc-spec-registry` 的稳定 Registry DTO、resolver 和 `TC_SPEC_*` 错误合同。

## Out of Scope

- Node Brief 文本、Watch 渲染和最终 Spec Impact UX，由 `tc-spec-delivery` 负责。
