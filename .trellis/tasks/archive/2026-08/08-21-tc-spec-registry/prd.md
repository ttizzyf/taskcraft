# Spec Registry 与 CLI 基础

## Goal

建立 Git-owned Taskcraft Spec Registry、安全文件解析和只读 CLI，为后续 lifecycle
binding 提供唯一、稳定、可测试的规范发现边界。

## Requirements

- `tc init` write-if-absent 创建 `.taskcraft/spec/index.json`，不覆盖用户文件。
- Registry 使用 `tc-spec-registry/v1` Schema，条目包含稳定 id、kind、path、summary、
  appliesTo、status；domain 条目必须提供 authority。
- 所有路径以项目根为边界，拒绝绝对路径、`..`/realpath/symlink 越界、目录和不可读文件。
- 单一 `src/spec/` 服务负责解析、Schema 校验、候选匹配和 SHA-256；CLI/doctor 后续复用。
- 实现 `tc spec list|check|resolve`，文本/JSON 来自同一 DTO，失败使用稳定 `TC_SPEC_*`。

## Acceptance Criteria

- [ ] 空项目初始化后 Registry 合法，再次 init 不改内容。
- [ ] 可登记 `.taskcraft/spec/` 或仓库内既有 Markdown，不复制正文。
- [ ] malformed、重复 id/path、missing、symlink escape、domain 无 authority 均显式失败。
- [ ] `list/check/resolve` 有正负 CLI 测试，resolve 只返回候选且不修改 Registry/Store。
- [ ] Registry 模块不依赖 reducer/projector，也不写 Task Store。

## Dependency

无。本 child 完成后，`tc-spec-lifecycle` 才能依赖其解析 DTO 和错误合同。

## Out of Scope

- Task/revision binding、Node Brief、Spec Impact、Watch UI。
- 自动创建规范正文或从代码推断业务规则。
