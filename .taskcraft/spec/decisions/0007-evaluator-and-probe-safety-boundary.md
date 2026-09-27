# ADR 0007：结果校验与 Agent 探测边界

- 状态：已接受
- 日期：2026-08-10
- 范围：Task 00

## Context

Taskcraft 需要校验 Agent 提交的结果；Agent 在规划和 Review 中也可能使用自己的
工具探测环境。两者不是同一个执行系统，Taskcraft 不需要再实现通用 probe runner。

## Decision Drivers

- Taskcraft 的结果校验没有 shell、网络或外部写入。
- 新凭据、付费、外部写入和高风险权限必须由用户决定。
- 失败必须显式，不能模拟成功或自动换路径。
- 敏感输出不能进入 event 或公开 evidence。
- 不复制宿主已经提供的工具执行和权限系统。

## Options

1. Taskcraft 实现通用 probe runner、权限分级和命令白名单。
2. Taskcraft 只校验结果；探测由 Agent 使用宿主工具执行并提交 evidence。
3. evaluator 也允许执行任意命令。灵活，但把校验变成隐式执行入口。

## Decision

采用选项 2：

- evaluator 是确定性、无副作用的本地函数，只读取提交的 fact/evidence 和内容
  引用，没有 shell、网络、凭据或写权限。
- Node Brief 可以说明需要验证的问题，但不包含 Taskcraft 自己的 probe runner。
  Agent 根据宿主已有工具选择怎么检查，并提交结果和必要 evidence。
- 探测需要新凭据、付费、外部写入或高风险权限时，Agent 先提交
  `needs_input|needs_decision` blocker 并询问用户。
- Taskcraft 不建立 probe id、命令模板、环境变量 allowlist、权限级别、预算策略、
  有效期或 runner 插件系统。
- timeout、认证失败、网络错误和 Schema 错误由 Agent 如实提交，不自动改成成功。
- raw secret、完整 prompt 和不必要的 transcript 不进入 Task Store。

## Consequences

- Taskcraft 的安全边界更小：只负责结果校验和记录。
- Agent 继续使用宿主原有权限与工具，不需要学习另一套 runner。
- 高风险检查仍会进入 waiting，但不需要授权子系统。

## Exit Cost

低。以后只有当 Taskcraft 自己需要执行固定检查时，才针对真实用例增加一个明确
命令，不先建设通用 runner。

## Contract Mapping

- lifecycle：定义 Agent 探测和 waiting gate。
- architecture：定义本地 evaluator 与 Agent 工具边界。
- SQL/JSON：复用 task fact、evidence 和 blocker，不新增 probe 实体。

## Task 01 Input

Task 01 只实现 JSON Schema 和 SQL 合同校验工具，不实现 probe 接口、runner、
权限类型或拒绝占位代码。

## Evidence

- 本次 CX/CL/DB 探针全部在明确临时目录运行并设置 60 秒硬超时。
- Claude setting source 隔离错误、预算终止与 Codex 502 均保留为不同历史
  结果；用户批准新预算策略后的成功复测作为新证据追加，没有覆盖旧失败。
- `development/specs/lifecycle.md` 第 9.1 节。
