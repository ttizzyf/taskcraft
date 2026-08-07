# Taskcraft 规范来源索引

本文件只负责把 Trellis 会话引向 Taskcraft 的现有权威资料，不保存或
改写产品合同。发生冲突时，以仓库根目录
[`AGENTS.md`](../../AGENTS.md) 和
[`development/README.md`](../../development/README.md) 定义的权威层级为准。

## 来源地图

| 来源 | 用途 | 约束 |
| --- | --- | --- |
| [`AGENTS.md`](../../AGENTS.md) | 产品不变量、仓库开发约束和验证顺序入口 | 先于其他开发文档适用 |
| [`development/specs/`](../../development/specs/) | 产品、生命周期、架构和 CLI 规范 | 规范性来源 |
| [`development/contracts/`](../../development/contracts/) | SQL、JSON Schema 和 fixtures | Task 00 冻结后成为可执行合同 |
| [`development/plans/`](../../development/plans/) | Task 00-06 的阶段输入与交付顺序 | 不改写产品规范或合同 |
| [`development/runbooks/`](../../development/runbooks/) | Trellis 开发与迁移操作 | 不构成 Taskcraft 运行时设计 |
| [`development/research/`](../../development/research/) | 带时效性的研究证据 | 写入规范、合同或 ADR 前不是长期事实 |
| [`development/prototypes/`](../../development/prototypes/) | Watch 交互参考 | 非规范，不代表生产状态或实现约定 |

## 使用方式

1. 先读 `AGENTS.md` 和 `development/README.md`，确定权威层级与任务边界。
2. 按当前 Trellis 任务只读取相关的规范、合同、阶段计划或 runbook。
3. 不把 Trellis 的 PRD、design、implement、journal、research 或本索引当成
   第二套产品合同。
4. 不从研究材料、静态原型或尚未实现的阶段计划推导代码约定。

## 当前代码规范状态

仓库尚无 Taskcraft 生产实现，因此没有可由真实源码和测试证明的 backend
或 frontend 代码规范。只有在工程代码形成稳定、重复的模式后，才新增对应
层的 Trellis 指南，并引用实际源码或测试作为依据。
