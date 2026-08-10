# Finalize Taskcraft Repository Contract Baseline

## Goal

在运行时合同冻结后，完成文档权威索引、最小工程模块边界、全量一致性验证
和 Task 01 交接，使后续工程基础任务无需重新解释 Task 00 决策。

## Dependencies

- `08-07-runtime-contract-freeze` 已完成并归档。
- 冻结后的 ADR、spec 和 contracts 均通过其子任务验证。

## Requirements

- 建立 `development/decisions/` 导航并修复文档索引/失效链接/旧编号引用。
- 明确 AGENTS、specs、contracts、plans、runbooks、research、prototypes、历史
  审计和 Trellis 工件的权威层级。
- 定义 Task 01 应创建的最小生产源码、测试、migration 和合同资产边界；本
  子任务只写设计，不创建生产目录。
- 为 Task 01 列出固定技术选择、安装/检查/测试/构建目标和直接输入。
- 对全部 ADR、spec、SQL/JSON、CLI 和阶段计划做最终一致性审阅。

## Acceptance Criteria

- [x] 文档入口无失效链接或旧任务编号引用，ADR 可从开发索引发现。
- [x] 研究、原型、计划、历史审计和 Trellis 工件均明确为非规范或相应层级。
- [x] 模块边界足够让 Task 01 建立工程，但未提前创建抽象或生产实现。
- [x] Task 01 输入包含技术栈、migration、Schema、测试、目录和验证要求。
- [x] SQL/JSON 解析、Markdown 链接和跨合同一致性检查全部通过。
- [x] Task 00 的所有交付可映射到父 PRD 验收标准。

## Out Of Scope

- 创建 `src/`、`tests/`、migration runner、锁文件或依赖配置。
- 修改已经批准的运行时产品语义。
- 开始 Task 01。
