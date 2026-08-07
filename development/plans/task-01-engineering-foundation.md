# 任务 01：工程基础与合同测试框架

## 目标

建立可重复安装、构建、测试和迁移的最小工程骨架，使后续任务只关注业务合同，不重复解决工具链问题。

## 依赖

- 任务 00 完成。
- 技术栈、迁移策略和模块边界已经由 ADR 冻结。

## 必读输入

- `AGENTS.md`
- 任务 00 产生的 ADR
- `development/contracts/storage.sql`
- `development/contracts/`
- `development/specs/architecture.md`

## 范围

1. 建立包管理、编译、格式化、静态检查和测试入口。
2. 建立 `src/` 与 `tests/` 的最小目录，不提前实现完整分层。
3. 把 SQL 草案转成可版本化 migration，并提供内存数据库测试工具。
4. 建立 JSON Schema 校验与 fixture 加载工具。
5. 定义稳定的测试超时和临时目录策略。
6. 建立 CI 可调用的统一检查命令，但不要求本任务配置远程 CI。

## 交付物

- 可安装的工程配置和锁文件。
- 空 CLI 入口或等价程序入口，能输出版本和帮助。
- migration runner 与第一版 schema migration。
- contract test harness、fixture helper 和 SQLite test helper。
- 开发、测试、构建命令文档。

## 验收标准

- 全新 checkout 可以通过一组明确命令完成安装、检查、测试和构建。
- migration 可在空数据库应用，重复应用有确定行为，失败不留下部分状态。
- 当前 JSON Schema fixture 可被验证。
- 测试不会写入仓库固定路径或依赖用户机器状态。
- 不存在吞掉异常或假装成功的 fallback。

## 非目标

- 不实现任务状态推导。
- 不实现任何真实 Taskcraft 命令。
- 不接入 Codex、Claude 或 Web UI。

## 验证

1. 工程基础测试。
2. 类型检查和 lint。
3. 构建。
4. 空数据库 migration smoke。

## 后续启动提示

任务标题：`Build Taskcraft engineering foundation`

请以工程 ADR、SQL 和 Schema 为实现输入，并遵守本文的验证顺序与 migration 失败要求。完成结果必须列出后续任务可直接调用的命令。
