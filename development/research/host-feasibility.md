# 宿主与首版技术可行性报告

> 当前决策证据截止 2026-08-10。本文保留较早的 Codex `0.146.1` 样本，
> 但能力定级以本节的当前版本探针为准。研究结论带版本和时间，不是产品合同。

## 0. Task 00 决策门探针（2026-08-10）

### 0.1 环境

| 工具 | 当前版本 |
| --- | --- |
| Codex CLI | `0.147.0` |
| Claude Code | `2.1.220` |
| SQLite | `3.50.6` |
| Node.js | `24.8.0` |
| pnpm | `10.33.0` |

所有模型探针均在 `/private/tmp` 的独立临时目录运行，使用最小 prompt、临时
Hook、只读 sandbox、现有登录和 60 秒硬超时。Claude 最终复测按用户明确授权
不设置费用上限。未安装项目或全局 Hook，未写 Taskcraft 产品数据库，也未创建
外部资源。

### 0.2 探针结果

| Probe | 命令摘要 | 结果 | 状态与限制 | 证据 digest |
| --- | --- | --- | --- | --- |
| `CX-01` | `codex --version`、`codex exec --help`、`codex features list` | exit `0`；help 含 JSON、output schema、resume；`hooks` 与 `multi_agent` 为 stable | `documented`；help 不等于模型行为 | 本报告版本化摘要 |
| `CX-02` | 临时 `SessionStart` + `Stop`，`codex exec --json` | exit `0`；`CX_FIRST` 后 Stop block，同一 session/turn 继续为 `CX_CONTINUED`；第二次 `stop_hook_active=true` | `verified`；首次 sandbox 内启动被 state 权限拒绝，批准后在同一临时目录重跑成功 | `b6240b38a1509ef21cbc1987c148fe55412a723dffa5ae0cc9de3084e32d6099` |
| `CX-03` | JSONL + `--output-schema` + 观察 Hook | 两次结构化调用都连续返回上游 `502` 并在 60 秒停止；同一时间不带 `--output-schema` 的对照调用 exit `0` 并返回 `CX_CONTROL_OK` | JSON event/correlation 为 `verified`；当前上游路径的原生 structured result 为 `limited`，问题已缩小到 output schema 路径 | 重测 Hook digest `91cca20aa9fc01d5855bdb934b044a6512d12bedf76a6d908ca39cee48798534` |
| `CL-01` | `claude --version`、`claude --help`、`claude agents --json` | exit `0`；help 含 session、JSON Schema、hook events、budget；agents 返回 `[]` | CLI 字段 `documented`，自定义 Agent 真实执行未验证 | 本报告版本化摘要 |
| `CL-02` | 临时 `SessionStart`、`Stop`、`SubagentStop` 与自定义 Agent | exit `0`；Agent 返回 `SUB_OK`；SubagentStop 含 agent id/type；主 Agent 返回 `CL_FIRST` 后 Stop block，同一 session 继续为 `CL_CONTINUED`，第二次 `stop_hook_active=true` | `verified`；Stop block 成功时 stream 仍出现一次 `stop-hook-error` UI notification，Adapter diagnostics 需识别 | `ab8b890f86a8c19bcbaf0cb0a1e77e7f633b0859c79e8da54a44917001d4b1e6` |
| `CL-03` | `--json-schema` + `--include-hook-events` | exit `0`；调用 `StructuredOutput`，最终 `structured_output={"status":"ok"}`，Stop Hook 成功 | `verified` | `74d9b0168d2c4875407f86bcc8ae959684609ed6904e302c3ff21289f75d9872` |
| `DB-01` | 内存 SQLite 重放 Review、evidence、event 与 R1 | 三个拒绝用例按预期 exit `1`；正向用例 exit `0`，`foreign_key_check` 为空 | `verified`；只证明当前 SQL 约束，不证明 reducer 事务 | storage digest `2ee017bbc9d6f38c87884a477bd9de66758fa99cea9a3f613f730ff56e6cf4f0` |

`CX-02` 的 JSONL `thread_id`、SessionStart `session_id` 和两次 Stop `session_id`
均为 `019fe96a-e8c1-7ef3-951c-f53418041807`；两次 Stop 的 `turn_id` 均为
`019fe96a-eaca-76e3-9869-be239c96ebe0`。这证明当前 Codex 版本可以关联 session
与 turn，但不构成 Review 身份签名。

`CX-03` 首次和重测的结构化请求都通过当前配置的 `/responses` 上游返回 `502`；
重测 session 为 `019fe98e-53ba-76f0-953d-559118cd6a72`。随后立即运行的不带
output schema 对照请求在 session `019fe98f-2403-7613-bc33-ac0dc724f9c6`
成功。因而这不是 Codex 整体不可用，也不像单次随机波动；更可能是当前上游、
模型或网关对原生 output schema 路径支持不完整。Taskcraft 必须把该能力作为
运行时探针结果，而不是版本级保证。

Claude 实际登录正常：默认或 `--setting-sources user,project` 时
`claude auth status` 返回 `loggedIn=true` 和 `oauth_token`。第一次探针错误使用
`--setting-sources project`，该模式返回 `loggedIn=false`；这是探针配置错误，
不是 Claude 能力问题。第二次带 `$0.10` 上限的探针在单次调用已超过上限后才
终止，证明该参数不是严格预扣上限。用户随后明确批准不设置费用上限；最终
CL-02 与 CL-03 均在 60 秒执行期限内成功。

`CL-02` 的 SessionStart、SubagentStop 和两次 Stop 使用同一
`session_id=9c0ec98f-101b-4175-97a7-c1f6ed37e46a`；SubagentStop 观察到
`agent_id=a272e563b4988097e` 和 `agent_type=tc-probe`。该 run 总费用约
`$0.057448`。`CL-03` 使用 session
`3f378d5e-af2a-429f-8a4b-5c7943892cf9`，费用约 `$0.016165`。

本次 Claude 探针实际使用 `deepseek-v4-flash`。模型能够调用自定义 Agent 和
StructuredOutput，是因为 Claude Code 把当前可用工具及说明提供给模型，并由
宿主执行工具和 Hook；这不代表模型能自动发现未注入的 Hook 配置或权限。
Taskcraft 因此在 Node Brief 中明确宿主和已知能力，不让模型自行猜测环境。

### 0.3 当前合同矛盾与决定

| 主题 | 当前矛盾 | ADR 决定 | 后续合同消费者 |
| --- | --- | --- | --- |
| Activation | `task new` 同时激活/建 attempt，但 queued 又表示未激活 | `task new` 只建 queued；第一次 `run` 激活并领取 attempt；建卡只要求目标、Level 和理由 | product、lifecycle、architecture、CLI、SQL |
| Review | R1/R2/R3、resolution 表和 outcome 重复表达返工 | 只保留 pass、changes requested、replan；不建 resolution 实体 | lifecycle、CLI、SQL、JSON |
| Input/Auth | Taskcraft 不执行外部操作，却准备建设输入、凭据和授权系统 | 复用 fact/blocker/event；secret 不落库；不建授权实体 | architecture、CLI、SQL、JSON |
| Capability | 研究证据和产品运行状态混在一起，SQL 又把 host 写死为两个值 | 五级状态只用于研究；host 用普通字符串；运行时只返回当前能力和失败原因 | Adapter、CLI、SQL、Watch |
| Toolchain | Task 01 没有冻结实现选择 | TypeScript、pnpm、better-sqlite3、Ajv 2020、Vitest | architecture、Task 01 |
| Migration | storage snapshot 与未来 migration 可能双写 | 最小顺序 SQL migration；snapshot 只由重放验证，不建生成系统 | SQL、Store、Task 01 |
| Safety | Taskcraft 结果校验与 Agent 环境探测混在一起 | Taskcraft 只校验；Agent 使用宿主工具探测并在高风险时询问用户 | lifecycle、architecture、CLI |
| Authority | 研究、计划、Trellis 与合同可能互相覆盖 | specs/contracts 是产品规则；其他材料只作说明；目录按需创建 | README、architecture、Task 01 |

### 0.4 需求到 ADR 映射

| 父任务需求 | 决策文件 | 直接证据或消费者 |
| --- | --- | --- |
| R1 Activation | `0001-task-activation-and-attempt-ownership.md` | CLI/状态矛盾矩阵 |
| R2 Review routing | `0002-review-purpose-and-remediation-routing.md` | DB-01 Review 约束、lifecycle 第 9 节 |
| R3 Input and safety boundary | `0003-revision-bound-inputs-and-authorization.md` | 现有 fact/blocker/secret 边界 |
| R4 Host evidence | `0004-host-capability-evidence-and-run-correlation.md` | CX-01..03、CL-01..03 |
| R5 Engineering | `0005-implementation-language-and-toolchain.md`、`0006-migrations-and-contract-validation.md` | 官方工具文档与本机版本 |
| R6 Safety | `0007-evaluator-and-probe-safety-boundary.md` | 本次探针执行边界 |
| R7 Authority | `0008-document-authority-and-module-boundaries.md` | AGENTS、development/README、Trellis 索引 |
| R8 Module boundary | `0008-document-authority-and-module-boundaries.md` | Task 01 目录和依赖方向 |

## 1. 评审结论

本报告覆盖当前 Codex CLI `0.147.0`、Claude Code `2.1.220`、Taskcraft 文档、
Schema 与静态原型，并保留 Codex `0.146.1` 的历史真实宿主样本。证据分为
官方文档、本机 CLI 探针、真实宿主冒烟和 SQLite 内存探针。

Taskcraft 的产品方向可实施。首版应采用以下技术边界：

- Codex 与 Claude Code 继续承担用户沟通、任务编排和 subagent 选择。
- Taskcraft 提供 Task Store、动态 lifecycle、Node Brief、CLI next、Review 关系、证据和只读进度投影。
- 首版只适配已经验证支持 Hook 的 Codex 与 Claude。Stop Hook 处理 Agent 的正常结束，用户打断始终有效；中断后通过 Task Store 恢复。
- Taskcraft 在 Node Brief 中给出执行和派发说明，不启动 subagent。Agent 有 subagent 工具就派发，没有就自己执行。
- 宿主 session/agent id 只作可选观察，不是身份凭证。缺失时留空，不增加补偿系统。
- 数据库存普通 host/adapter id，不建立 Codex/Claude 枚举或 Adapter 注册表；首版
  代码只实现这两个 Adapter。
- 五级能力状态只属于本报告；产品运行时只需要当前能力、测试时间和失败原因。
- Phase 1 先交付固定内置 L1/L2 图和串行闭环；动态 compiler、L3 子任务聚合与完整 Watch 在各自验证门通过后进入实现。

当前仓库是交互、命令和数据结构原型。`tc`、reducer、projector、adapter、compiler 与 Watch 服务仍待实现；静态页面和 Schema 只代表设计合同。

## 2. 状态定义

| 状态 | 含义 |
| --- | --- |
| `verified` | 官方资料与本机真实行为共同证明 |
| `documented` | 官方已定义，本机真实宿主冒烟待完成 |
| `limited` | 能力可用，存在明确宿主或实现边界 |
| `pending` | 需要环境、凭据或 Taskcraft 实现后才能完成验证 |
| `deferred` | 成本或不确定性高于首版收益 |

## 3. Codex 能力矩阵

| 能力 | 状态 | 证据与边界 | 首版方案 |
| --- | --- | --- | --- |
| `SessionStart` 注入 | `verified` | 本机真实 payload 含 `session_id`、`cwd`、`source=startup`、`permission_mode`；额外上下文成功进入运行 | 用于首次进入、resume、clear 与 compact 后恢复 breadcrumb |
| `Stop` 连续执行 | `verified` | 本机第一次返回 `decision:block` 后，Codex 在同一 `session_id`、`turn_id` 生成第二次模型响应；第二次 payload 的 `stop_hook_active=true` | Hook 读取 projector；active 时给出 next，waiting/done/cancelled 时放行；用户打断不受限制 |
| `SubagentStart/Stop` | `documented` | 官方字段包含 `agent_id`、`agent_type`、父 `session_id` 与 subagent transcript；子 Agent 共用父 session id | Agent 自己决定是否派发；可获得的 `agent_id` 只写观察字段 |
| Tool hooks | `limited` | 本地 Bash、patch、MCP 和多数 function tool 可观察；hosted WebSearch 等路径不完整；PostToolUse 无法撤销副作用 | 用于审计和守门，不作为完整安全边界 |
| `codex exec --json` | `verified` | 本机输出 `thread.started`、`turn.started`、`item.completed`、`turn.completed`，退出码为 0 | Adapter 可选保存 `thread_id` 和退出码；不要求额外 supervisor |
| 结构化结果 | `limited` | 官方支持 `--output-schema`，但当前上游路径连续两次返回 `502`；普通对照请求成功 | Adapter 披露 native capability；所有最终结果仍由本地 Ajv 校验，失败显式返回 |
| 原生 subagent | `limited` | `multi_agent` 在本机为 stable；交互式 Agent 可以调用原生工具；`codex exec` 没有确定性 spawn 参数 | 有工具就由 Agent 使用，没有就当前 Agent 自己执行 |
| 长驻控制 | `documented` | App Server、MCP Server 与 SDK 支持 thread start/resume/turn；本机 MCP Server 需要可写 Codex state | 首版不依赖；出现无人值守需求后再评估 |
| Review 身份观察 | `limited` | Hook 可见 session/turn/agent id，宿主没有 Taskcraft attempt attestation 或 review 内容签名 | 有字段就记录，没有就标记 `unverified`，不阻断普通 Review |

### 3.1 历史样本：Codex 0.146.1 Stop 本机冒烟

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
| `UserPromptSubmit/SessionStart` | `limited` | `2.1.220` 的 SessionStart Hook 与 event stream 已在认证前真实执行；UserPromptSubmit 仍只有官方资料 | 主 Agent 使用 Hook 注入 breadcrumb；UserPromptSubmit 需另行 smoke |
| `Stop/SubagentStop` | `verified` | `2.1.220` 真实完成 SubagentStop；Stop 第一次 block 后同 session 继续，第二次 `stop_hook_active=true` 后放行 | 安装时运行 Hook 测试；用户打断始终有效 |
| `SubagentStart/Stop` 身份字段 | `verified` | event stream 与 SubagentStop payload 已观察到 session id、agent id、agent type、transcript path 和最后消息 | 可获得的字段作为 observation；缺失就留空 |
| CLI session 控制 | `documented` | 本机 help 包含 `--session-id`、`--resume`、`--fork-session`、`--no-session-persistence`；本次只观察到新 session id | 首版不建立 Dispatch 实体；attempt id 已足够关联结果 |
| 结构化输入输出 | `verified` | stream-json 包含 Hook events；`--json-schema` 真实调用 StructuredOutput 并返回 `{"status":"ok"}` | 原生 Schema 可用但非必需；Taskcraft 写入时仍本地校验 |
| 自定义 Agent | `verified` | 临时 `tc-probe` 以前台方式完成，返回 `SUB_OK`，SubagentStop 和 agent id 均可观察 | Agent 有需要时自主使用；Taskcraft 不负责启动 |
| 后台与 worktree | `documented` | 本机 help 包含 `--background` 与 `--worktree`，未运行行为探针 | 作为宿主可选能力；首版串行路径不依赖它们 |
| 非交互推理 | `verified` | `claude -p` 使用当前用户配置的 `deepseek-v4-flash` 完成主 Agent、subagent、Stop continuation 和 structured result | resume 仍需单独 smoke；本项只证明非交互执行路径 |
| `--max-turns` | `deferred` | 本机 help 未列该参数 | 首版不依赖该参数 |
| Review 身份观察 | `limited` | 当前已真实观察到 session UUID、agent id 和 agent type，但宿主没有 Taskcraft attempt attestation | 有字段就记录，没有就标记 `unverified`，不阻断普通 Review |

## 5. Schema 内存探针

SQLite 草案已完成四项针对性回归：

| 探针 | 必须成立的不变量 | 已验证结果 |
| --- | --- | --- |
| revision 2 Review 关联 revision 1 Plan | Review 与被审核 attempt 位于同一 lifecycle revision | 跨 revision 写入返回 constraint error |
| Plan evidence 满足 Execute required obligation | evidence 归属于目标 revision 与 node attempt | 错误节点 evidence 返回 constraint error |
| `task_seq=1` 后写入 `task_seq=3` | 每个 task 的 event sequence 从 1 连续递增 | 乱序 event 返回 constraint error |
| Reviewer 直接修复 | 当前 SQL 能保存旧版 R1 resolution | `passed_with_fix` 与 `review_resolutions.r1_direct_fix` 写入成功；后续合同将按 ADR 0002 删除该重复实体 |

更新后的 SQL 已真实验证：旧版 R1 resolution 和正确节点 evidence 写入成功；跨 revision Review、错误节点 evidence 与乱序 event 均以 SQLite constraint error 拒绝；`PRAGMA foreign_key_check` 无结果。该探针证明 SQL 按当时设计工作，不代表每张表都必须保留。ADR 0002 已决定删除重复的 resolution 实体。

## 6. 首版可行性验证门

### Gate H1：静默入口与连续执行

必须验证：

- `off`、普通问答和无 durable task 时保持零 Hook 输出、零 Task Store 写入。
- active task 只注入 task anchor、当前节点与唯一 next。
- Stop 第一次阻止 Agent 正常结束；`stop_hook_active` 防止 Hook 自身循环；用户打断
  始终有效。
- malformed JSON、Hook timeout、未信任项目和 Hook 禁用都进入 diagnostics。

通过标准：Codex 与 Claude Code 分别完成 ordinary、off、active、waiting、done、timeout 六类真实样本。Adapter 只在真实 Stop 冒烟通过后报告 `enforced`；其余环境报告 `advisory`。

恢复方案：中断后由 Entry Hook 提供 breadcrumb，Agent 通过 `tc task next` 继续。

### Gate D1：Store、reducer 与 projector

必须验证：

- SQLite foreign keys、WAL、busy timeout、CAS 与失败事务回滚。
- Review link 与被审核 attempt 位于同一 task 和 lifecycle revision。
- required obligation 只接受归属于目标节点 attempt 的有效 evidence。
- 每个 task 的 event sequence 从 1 单调递增。
- CLI、breadcrumb、Watch 和 export 使用同一 `project()` 结果。

通过标准：并发冲突、崩溃回滚、跨 revision 引用、错误 evidence、非法 graph 与事件乱序测试全部稳定失败，且 Task Store 无部分写入。

降级方案：Phase 1 使用单机串行写入、内置 L1/L2 图和应用层 reducer 校验；并行执行与跨 revision evidence reuse 延后。

### Gate R1：Review 与返工

必须验证：

- `passed` 按图进入下一节点；Reviewer 做过修改时把 diff 和验证作为 evidence。
- `changes_requested` 创建被审核 node 的同 kind successor attempt。
- `replan_required` 创建新 lifecycle revision。
- Agent 有 subagent 工具时可以派独立 reviewer；没有时自己执行并披露
  `same-actor`，普通 Review 不因此卡住。

通过标准：通过、修改和重新规划三个样本的 finding、evidence、successor 与
revision 均可查询，不需要 `review_resolutions` 表。

身份字段缺失时留空或标记 `unverified`，不生成补偿记录。

### Gate P1：Feasibility 探测

必须验证：

- Node Brief 说明需要验证的问题，Agent 使用宿主已有工具执行。
- 需要凭据、付费或副作用时，Agent 先进入
  `waiting(needs_input|needs_decision)` 并询问用户。
- Agent 提交必要的结果摘要和 evidence，不保存 secret 或完整 transcript。
- advisory finding 不阻止 Plan；意图遗漏、阻断性假设、不可执行依赖或缺失集成路径阻止 Plan。

通过标准：一个只读探测和一个需要用户决定的样本可以完整记录与恢复。

Taskcraft 不实现自动 probe runner；没有可用工具时，Agent 记录 blocker 或人工
研究引用。

### Gate L3：子任务与 Integrate

必须验证：

- Plan child、依赖边、owner、run observation、result 与 integration input 可查询。
- 多分支全部满足 required obligations 后 Integrate 才可运行。
- stale、retry、冲突与部分失败保持明确 owner 和恢复动作。

通过标准：两个 child、一个冲突和一个 stale 的串行/并行 fixture 能完整闭环。

降级方案：L3 使用主 Agent 串行执行；child 结果以 Task fact 与 evidence 归集；完整并行和跨宿主 observe 延后。

## 7. 开发顺序

1. Phase 0A 完成两宿主 Hook、session、structured output 与可选身份字段真实冒烟。
2. Phase 0B 冻结 Store 不变量、三个 Review outcome 和同源 fixtures。
3. Phase 1 实现固定内置 L1/L2 图、CLI、reducer/projector 和串行闭环。
4. Phase 2 实现 Agent 驱动的 Feasibility 探测、基础 L3 与 Integrate。
5. Phase 3 实现同源 Watch；完整 observe 和 importer 有真实需求时再加入。

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

后续 Feasibility Reviewer 只保存理解结论所需的信息：

```text
question or assumption
method and source/version
observed result
status and limitation
affected task/node
timestamp and evidence reference
```

Task fact 与 evidence 是结果入口；五级状态是研究方法，不要求产品建立能力证据
实体、有效期或自动去重系统。
