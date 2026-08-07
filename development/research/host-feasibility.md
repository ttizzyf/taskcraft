# 宿主与首版技术可行性报告

## 1. 评审结论

本轮评审覆盖 Codex CLI `0.146.1`、Claude Code `2.1.220`、Taskcraft 文档、Schema 与静态原型。证据分为官方文档、本机 CLI 探针、真实宿主冒烟和 SQLite 内存探针。

Taskcraft 的产品方向可实施。首版应采用以下技术边界：

- Codex 与 Claude Code 继续承担用户沟通、任务编排和 subagent 选择。
- Taskcraft 提供 Task Store、动态 lifecycle、Node Brief、CLI next、Review 关系、证据和只读进度投影。
- Entry Hook 与 Stop Hook 提供上下文注入和连续执行守门；外部 supervisor 提供更强的无人值守连续性。
- 首版 Review 身份能力使用 `context-only`、`manual-attach` 和 `host-observed`。界面分别显示 `observed-distinct`、`unverified`、`same-actor` 或 `unsupported`。
- 原生 subagent 用于 Agent 自主编排。需要确定性启动、等待和结果回收时，每个执行者使用独立 CLI session、SDK thread、MCP thread 或 App Server thread。
- Phase 1 先交付固定内置 L1/L2 图和串行闭环；动态 compiler、L3 子任务聚合与完整 Watch 在各自验证门通过后进入实现。

当前仓库是交互、命令和数据结构原型。`tc`、reducer、projector、adapter、compiler 与 Watch 服务仍待实现；静态页面和 Schema 只代表设计合同。

## 2. 状态定义

| 状态 | 含义 |
| --- | --- |
| `verified` | 官方资料与本机真实行为共同证明 |
| `documented` | 官方已定义，本机真实宿主冒烟待完成 |
| `limited` | 能力可用，存在明确宿主或实现边界 |
| `pending` | 需要实现 Taskcraft 后才能完成端到端验证 |
| `deferred` | 成本或不确定性高于首版收益 |

## 3. Codex 能力矩阵

| 能力 | 状态 | 证据与边界 | 首版方案 |
| --- | --- | --- | --- |
| `SessionStart` 注入 | `verified` | 本机真实 payload 含 `session_id`、`cwd`、`source=startup`、`permission_mode`；额外上下文成功进入运行 | 用于首次进入、resume、clear 与 compact 后恢复 breadcrumb |
| `Stop` 连续执行 | `verified` | 本机第一次返回 `decision:block` 后，Codex 在同一 `session_id`、`turn_id` 生成第二次模型响应；第二次 payload 的 `stop_hook_active=true` | Hook 读取 projector；active 时给出 next，waiting/done/cancelled 时放行；每个 attempt 使用次数与时间预算 |
| `SubagentStart/Stop` | `documented` | 官方字段包含 `agent_id`、`agent_type`、父 `session_id` 与 subagent transcript；子 Agent 共用父 session id | 用 `agent_id` 作为宿主观察字段；Taskcraft attempt id 由 Node Brief 显式携带 |
| Tool hooks | `limited` | 本地 Bash、patch、MCP 和多数 function tool 可观察；hosted WebSearch 等路径不完整；PostToolUse 无法撤销副作用 | 用于审计和守门，不作为完整安全边界 |
| `codex exec --json` | `verified` | 本机输出 `thread.started`、`turn.started`、`item.completed`、`turn.completed`，退出码为 0 | supervisor 保存 `thread_id`、事件与退出码；非 ephemeral session 可 resume |
| 结构化结果 | `documented` | 官方支持 `--output-schema` 与最终消息输出 | Reviewer 和 Node result 使用 JSON Schema |
| 原生 subagent | `limited` | `multi_agent` 在本机为 stable；交互式 Agent 可以调用原生工具；`codex exec` 没有确定性 spawn 参数 | 自主任务使用原生 subagent；确定性节点使用独立 thread/session |
| 长驻控制 | `documented` | App Server、MCP Server 与 SDK 支持 thread start/resume/turn；本机 MCP Server 需要可写 Codex state | supervisor 需要持久状态时使用 SDK/App Server；安装检查 state 写权限 |
| Review 身份证明 | `limited` | Hook 可见 session/turn/agent id，宿主没有 Taskcraft attempt attestation 或 review 内容签名 | 保存 host-observed correlation；放行条件不依赖强身份认证 |

### 3.1 Codex Stop 本机冒烟

探针在临时目录通过 session config 安装 `SessionStart` 与 `Stop` command hook，使用：

```bash
codex exec --dangerously-bypass-hook-trust \
  --ephemeral --skip-git-repo-check --sandbox read-only --json \
  -c 'hooks.Stop=[...]' -c 'hooks.SessionStart=[...]' \
  "Reply exactly TC_FIRST."
```

观察结果：

```text
agent_message: TC_FIRST
Stop #1: stop_hook_active=false -> decision:block
agent_message: TC_CONTINUED
Stop #2: stop_hook_active=true -> allow
turn.completed
```

两次 Stop 事件使用同一 `session_id=019fdafd-d1f3-75a3-b869-3b65be7aa98f` 与 `turn_id=019fdafd-d546-77d3-8ae9-d15b0301d6a4`。该结果证明 Codex `0.146.1` 能在同一 turn 内执行连续守门。项目级 Hook 仍受项目 trust、Hook review、用户配置和 managed policy 约束；Adapter 必须通过 `tc agent test-hook` 记录实际能力。

## 4. Claude Code 能力矩阵

| 能力 | 状态 | 证据与边界 | 首版方案 |
| --- | --- | --- | --- |
| `UserPromptSubmit/SessionStart` | `documented` | 官方 Hooks 文档支持额外上下文；本项目已有同类 breadcrumb 模式 | 主 Agent 使用 Hook 注入 breadcrumb；真实 `2.1.220` 冒烟进入 Phase 0 |
| `Stop/SubagentStop` | `documented` | 官方支持 `decision:block` 和 exit 2；`stop_hook_active` 用于循环保护 | Adapter 同时测试两种返回方式，记录宿主版本；Hook 只做 gate 和继续提示 |
| `SubagentStart/Stop` 身份字段 | `documented` | 当前官网定义 `agent_id`、`agent_type`、`agent_transcript_path`；较旧 plugin-dev 资料字段不完整 | 运行时 capability probe 决定字段可用性；缺失字段时使用 session manifest |
| CLI session 控制 | `verified` | 本机 help 包含 `--session-id`、`--resume`、`--fork-session`、`--no-session-persistence` | `dispatchId + sessionId` 是 manual attach 主键 |
| 结构化输入输出 | `verified` | 本机 help 包含 stream-json、`--json-schema`、`--include-hook-events` 与 `--forward-subagent-text` | Reviewer 输出使用 JSON Schema；Hook 事件进入 observation |
| 自定义 Agent | `verified` | 本机支持 `--agent`、`--agents <json>` 与 `claude agents --json`；后者真实返回 `[]` | Feasibility Reviewer、Executor 与 Delivery Reviewer 使用独立定义和最小工具集 |
| 后台与 worktree | `verified` | 本机 help 包含 `--background` 与 `--worktree` | 作为宿主可选能力；首版串行路径不依赖它们 |
| 非交互推理 | `pending` | 本机 `claude -p` 在线会话长时间等待后中止，未获得 JSON 结果 | 在联网 CI 运行真实 Hook、JSON Schema、resume 与 subagent smoke 后定级 |
| `--max-turns` | `deferred` | 本机 help 未列该参数 | 使用 Hook attempt counter、`--max-budget-usd` 与 supervisor deadline |
| Review 身份证明 | `limited` | session UUID 与 agent id 可关联运行，Taskcraft attempt 仍需显式 manifest | 保存 host-observed correlation；Reviewer 输出 hash、evidence refs 与 session 观察 |

## 5. Schema 内存探针

SQLite 草案已完成四项针对性回归：

| 探针 | 必须成立的不变量 | 已验证结果 |
| --- | --- | --- |
| revision 2 Review 关联 revision 1 Plan | Review 与被审核 attempt 位于同一 lifecycle revision | 跨 revision 写入返回 constraint error |
| Plan evidence 满足 Execute required obligation | evidence 归属于目标 revision 与 node attempt | 错误节点 evidence 返回 constraint error |
| `task_seq=1` 后写入 `task_seq=3` | 每个 task 的 event sequence 从 1 连续递增 | 乱序 event 返回 constraint error |
| Reviewer 直接修复 | R1 保存修复者、变更摘要、证据和 typed resolution | `passed_with_fix` 与 `review_resolutions.r1_direct_fix` 写入成功 |

更新后的 SQL 已真实验证：R1 resolution 和正确节点 evidence 写入成功；跨 revision Review、错误节点 evidence 与乱序 event 均以 SQLite constraint error 拒绝；`PRAGMA foreign_key_check` 无结果。Reducer 仍负责 actor constraint、finding 语义、CAS 和事务级原子写。

## 6. 首版可行性验证门

### Gate H1：静默入口与连续执行

必须验证：

- `off`、普通问答和无 durable task 时保持零 Hook 输出、零 Task Store 写入。
- active task 只注入 task anchor、当前节点与唯一 next。
- Stop 第一次阻止未完成节点结束；`stop_hook_active`、attempt budget 或 deadline 终止无界循环。
- malformed JSON、Hook timeout、未信任项目和 Hook 禁用都进入 diagnostics。

通过标准：Codex 与 Claude Code 分别完成 ordinary、off、active、waiting、done、timeout 六类真实样本。Adapter 只在真实 Stop 冒烟通过后报告 `enforced`；其余环境报告 `advisory`。

降级方案：Entry Hook 提供恢复 breadcrumb；Agent 或 supervisor 通过 `tc task next` 恢复运行。

### Gate D1：Store、reducer 与 projector

必须验证：

- SQLite foreign keys、WAL、busy timeout、CAS 与失败事务回滚。
- Review link 与被审核 attempt 位于同一 task 和 lifecycle revision。
- required obligation 只接受归属于目标节点 attempt 的有效 evidence。
- 每个 task 的 event sequence 从 1 单调递增。
- CLI、breadcrumb、Watch 和 export 使用同一 `project()` 结果。

通过标准：并发冲突、崩溃回滚、跨 revision 引用、错误 evidence、非法 graph 与事件乱序测试全部稳定失败，且 Task Store 无部分写入。

降级方案：Phase 1 使用单机串行写入、内置 L1/L2 图和应用层 reducer 校验；并行执行与跨 revision evidence reuse 延后。

### Gate R1：Review 独立性与三级返工

必须验证：

- R1 直接修复记录 Reviewer、变更摘要、diff/evidence、验证和 `passed_with_fix`。
- R2 创建 focused Execute successor attempt，并只 Review 新增变更与受影响范围。
- R3 创建新 lifecycle revision；L3 新 Plan 重新经过 Feasibility Review。
- UI 展示 `context-only|manual-attach|host-observed` 和 `observed-distinct|unverified|same-actor|unsupported`。

通过标准：Codex 与 Claude Code 各完成 typo、跨文件实现缺陷、合同变化三个样本，历史 finding、修复者、successor 与 revision 均可回放。

降级方案：宿主身份关联失败时使用 `manual-attach + unverified`；R2/R3 继续运行，Gate 不声称已证明独立实例。

### Gate P1：Feasibility Probe

必须验证：

- allowlisted 只读探针保存命令、版本、时间、退出码、timeout、脱敏摘要、digest 与 evidence。
- 需要凭据、付费或副作用的探针进入 `waiting(needs_input|needs_decision)`。
- 重复 probe 支持去重与有效期判断。
- advisory finding 不阻止 Plan；意图遗漏、阻断性假设、不可执行依赖或缺失集成路径阻止 Plan。

通过标准：本机 CLI 能力探针、外部 API 待授权探针和过期探针三类 fixture 可重放。

降级方案：Feasibility Reviewer 保存人工研究引用和 Task fact；自动 probe runner 延后。

### Gate L3：子任务与 Integrate

必须验证：

- Plan child、依赖边、owner、run observation、result 与 integration input 可查询。
- 多分支全部满足 required obligations 后 Integrate 才可运行。
- stale、retry、冲突与部分失败保持明确 owner 和恢复动作。

通过标准：两个 child、一个冲突和一个 stale 的串行/并行 fixture 能完整闭环。

降级方案：L3 使用主 Agent 串行执行；child 结果以 Task fact 与 evidence 归集；完整并行和跨宿主 observe 延后。

## 7. 开发顺序

1. Phase 0A 完成两宿主 Hook、session、structured output 与身份字段真实冒烟。
2. Phase 0B 冻结 Store 不变量、Review R1/R2/R3 数据合同和同源 fixtures。
3. Phase 1 实现固定内置 L1/L2 图、CLI、reducer/projector、advisory/manual attach 和串行闭环。
4. Phase 2 实现 Feasibility Probe、基础 L3、动态 compiler/interpreter 与 Integrate。
5. Phase 3 实现同源 Watch、深链、完整 observe 与 Kitepath importer。

每个阶段以本报告对应 Gate 为进入条件。未通过的宿主能力使用该 Gate 的降级方案。

## 8. 官方资料

### Codex

- [Hooks](https://learn.chatgpt.com/docs/hooks)
- [Advanced configuration](https://learn.chatgpt.com/docs/config-file/config-advanced#hooks)
- [Subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents)
- [Non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode)
- [App Server](https://learn.chatgpt.com/docs/app-server)
- [Codex SDK](https://learn.chatgpt.com/docs/codex-sdk)
- [Codex MCP server](https://learn.chatgpt.com/docs/mcp-server)

### Claude Code

- [Hooks](https://code.claude.com/docs/en/hooks)
- [Hooks guide](https://code.claude.com/docs/en/hooks-guide)
- [Subagents](https://code.claude.com/docs/en/sub-agents)
- [CLI reference](https://code.claude.com/docs/en/cli-reference)
- [Agent SDK subagents](https://code.claude.com/docs/en/agent-sdk/subagents)

## 9. 证据留存规则

后续 Feasibility Reviewer 为每项探测保存：

```text
assumption
probe method and environment
source URL or command version
observed result
status: verified | documented | limited | pending | deferred
constraint and expiry
chosen fallback
affected task/node/acceptance
evidence digest and timestamp
```

Task fact 与 evidence 是探测结果的规范留存入口。方案文档引用这些事实，不复制并改写宿主能力结论。
