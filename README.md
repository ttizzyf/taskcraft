# Taskcraft

Taskcraft 是面向 Codex 与 Claude Code 的 agent-first 任务协议、状态工具与可视化记录方案。SQLite Task Store 是唯一可写事实源，Agent 通过 CLI 推进任务，用户通过 Watch 查看任务、节点、证据和运行状态。

当前仓库处于开发准备阶段，包含产品规范、可执行合同、架构决策、开发任务和交互原型，尚未包含生产实现。Trellis `0.6.14` 已初始化，Bootstrap 已完成并归档；Task 00 已完成宿主探针、架构决策和运行时合同冻结，正在进行最终仓库基线整理。Taskcraft MVP 验收后将退出 Trellis 并开始狗粮化。

## 入口

- [开发指南](development/README.md)：规范、合同、Task 00–06、Trellis 工作流与迁移方案的唯一入口。
- [交互原型](development/prototypes/watch.html)：当前 Watch 交互概念的静态演示。
