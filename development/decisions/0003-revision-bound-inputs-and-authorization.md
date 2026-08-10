# ADR 0003：用户输入、敏感信息与高风险操作

- 状态：已接受
- 日期：2026-08-10
- 范围：Task 00

## Context

Taskcraft 负责记录任务，不负责替 Agent 执行外部操作。现有设计准备为用户输入、
凭据和授权分别建立实体，但这会在没有执行需求前先造一套权限系统。

## Decision Drivers

- SQLite 不保存明文 secret。
- Agent 遇到付费、外部写入、新凭据或高风险权限时先询问用户。
- 用户决定能够随任务恢复，但不复制敏感内容。
- 不为 Taskcraft 不执行的动作建立授权校验器。

## Options

1. 新建 Input、Credential、Authorization 三套实体和校验器。
2. 复用现有 task fact、blocker 和 event，只记录必要的非敏感决定。
3. 完全不记录用户决定，只留在宿主会话；最简单，但无法恢复。

## Decision

采用选项 2：

- 缺少输入时写 `needs_input` blocker；需要用户决定时写 `needs_decision` blocker。
- 用户的非敏感回答写入现有 `task_facts`，带当前 lifecycle revision 和来源即可。
- secret 值永远不写 Task Store、event、evidence summary 或日志。Agent 直接使用
  宿主已有的凭据能力，Taskcraft 不保存 credential reference。
- 高风险操作由 Node Brief 要求 Agent 先询问用户。用户同意后记录一条简短的
  `constraint` fact，再由 Agent 自己执行；Taskcraft 不签发或校验授权凭证。
- lifecycle 或操作目标发生实质变化时，Agent 再次询问用户。当前不实现 action
  digest、费用上限、过期时间或 one-shot/reusable 策略。

## Consequences

- 不新增表和类型。
- 用户决定可以跨会话恢复，同时不把 secret 放进 SQLite。
- Taskcraft 不承担它无法真正控制的外部权限保证。

## Exit Cost

低。以后只有当 Taskcraft 自己开始执行外部副作用时，才为真实执行边界单独设计
授权合同。

## Contract Mapping

- lifecycle：定义何时进入 `needs_input|needs_decision`。
- architecture：定义 task fact、blocker 和 secret 不落库边界。
- CLI：复用 fact/blocker 命令，不增加授权命令组。
- SQL/JSON：不新增 Input、Credential 或 Authorization 实体。

## Task 01 Input

Task 01 不实现输入、凭据或授权系统，只保证日志和测试 fixture 不写入 secret。

## Evidence

- `development/contracts/storage.sql` 已有 task fact、blocker 和 event。
- `development/specs/lifecycle.md` 对付费、凭据和高风险权限的决策门。
- `development/specs/architecture.md` 的 secret redaction 与 side-effect gate。
