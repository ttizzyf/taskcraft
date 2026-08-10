# ADR 0008：文档权威与初始模块边界

- 状态：已接受
- 日期：2026-08-10
- 范围：Task 00

## Context

仓库同时包含规范、合同、计划、研究、原型、Trellis 工件和未来生产代码。
如果这些材料都能定义行为，Task 01 会面对多套事实源。

## Decision Drivers

- 产品规则只有一个权威位置。
- Trellis 任务和研究不能升级为产品合同。
- Command service 必须是 SQLite 唯一写入口。
- Task 01 只创建实际使用的文件和目录。

## Options

1. 把资料分成“产品规则”和“说明材料”，代码按实际需要增长。
2. 把 ADR 或 Trellis PRD 当成运行时规范。方便当前任务，但形成第二事实源。
3. 一开始建立完整分层和多 package。整齐，但大部分只是空壳。

## Decision

采用选项 1，并保持单 package 起步：

- `development/specs/` 定义产品行为，`development/contracts/` 定义可执行数据
  格式。根 `AGENTS.md` 只保留重要不变量和开发入口，不复制细节。
- ADR 解释为什么这样选；plans 只安排先后；research、prototype 和 Trellis 文件
  只提供工作材料。它们都不能覆盖 specs/contracts。
- Task 01 只创建工程配置、CLI 空入口、`migrations/`、最小 SQLite/Ajv helper 和
  对应 contract tests。没有实际代码的 `domain/command/adapters/watch` 目录不创建。
- 后续实现出现时再按 `domain`、`store`、`command`、`cli`、`adapters` 的职责
  分开。只维持 `command service` 是唯一写入口这一条必要依赖规则。
- 不为未来 driver、模型 SDK 或多 package 预建 interface、port 或空模块。

## Consequences

- 初始只有一个 package，不建立 workspace package 边界。
- ADR 变更不能直接改变运行时行为；必须同步到权威 spec/contract。
- Task 01 不产生空目录和占位接口。

## Exit Cost

低。代码增加时移动少量文件，比长期维护空抽象成本更低。

## Contract Mapping

- `development/README.md` 提供简单导航和权威说明。
- architecture 只定义已经存在的职责和唯一写入口。
- Task 01 不创建 Adapter、domain、command 或 Watch 占位模块。

## Task 01 Input

只建立安装、构建、空 CLI、migration 和 contract test 所需文件。Adapter、
reducer、projector、command service、Watch 与动态 compiler 都不进入 Task 01。

## Evidence

- 根 `AGENTS.md` 的 Product invariants 与 repository scope。
- `development/README.md` 的现有导航。
- `.trellis/spec/taskcraft.md` 的来源地图。
