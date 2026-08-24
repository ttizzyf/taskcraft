# Spec Node Brief、收口与诊断

## Goal

把 revision binding 交付给 Execute/Review Agent，并以 Spec Impact、doctor、CLI 和
Watch 完成可审计闭环。

## Requirements

- Node Brief DTO/host renderer 显示 exact Spec id/kind/duty/path/digest。
- `review start` 返回 Review Node Brief，使用当前 Review node 的同源 binding。
- 新 compiler Record schema/obligation 要求 `none | updated | candidate` Spec Impact；
  domain candidate 不自动成为 Registry truth。
- task show、CLI render、Watch Task Detail、doctor 使用同一 query/Registry service；
  frontend 不重新推断绑定或漂移。
- 新旧 compiler 并存；旧 Task 不要求 Spec Impact。

## Acceptance Criteria

- [ ] Codex/Claude 对同一 Node Brief 输出同一 Spec 合同。
- [ ] Execute 与 Review 获得正确 revision/node bindings，required drift 在 attempt 前失败。
- [ ] 三种 Spec Impact 正负验证和 evidence/authority 约束通过。
- [ ] doctor 覆盖 Registry、binding、impact、L3 provenance；旧 revision 合法。
- [ ] Watch 桌面/移动 smoke 无重叠并与 CLI DTO 同源。
- [ ] 公开 CLI 回放 L1/L2/L3 single/modules 与 pre-0003 compatibility。

## Dependency

依赖 `tc-spec-registry` 和 `tc-spec-lifecycle` 完成；不得在本 child 重写 Registry 或
binding 解析。

## Out of Scope

- 修改 Entry/Stop Hook 或引入 Taskcraft subagent dispatcher。
