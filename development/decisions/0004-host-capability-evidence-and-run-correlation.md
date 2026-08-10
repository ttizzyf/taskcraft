# ADR 0004：宿主能力与 Run 关联

- 状态：已接受
- 日期：2026-08-10
- 范围：Task 00

## Context

Codex 和 Claude 的 Hook、subagent 和结构化输出能力不同。研究需要区分文档与
实测，但生产代码只需要知道当前功能能不能用，并把可获得的宿主 run 信息关联
到 attempt。

## Decision Drivers

- 首版只适配已验证支持 Hook 的 Codex 和 Claude。
- 观察事实不能改变 reducer 状态。
- 模型只能看到宿主实际提供给它的工具和上下文，不能让模型猜隐藏配置。
- 不把研究证据体系做成生产实体。

## Options

1. 在产品数据库保存五级证据、有效期和探针历史。
2. 研究报告保留完整证据；运行时只返回当前能力和可选宿主标识。
3. 不记录任何宿主能力；实现少，但无法诊断 Hook 安装问题。

## Decision

采用选项 2：

- `verified|documented|limited|pending|deferred` 只用于研究报告和 Adapter 开发
  验收，不建立 `CapabilityEvidence` 表、Schema、过期策略或历史查询。
- 数据库中的 host/adapter id 使用普通字符串，不用 `codex|claude` CHECK，也不
  新建 Adapter 注册表。首版实现只识别 `codex` 和 `claude`，其他值由 Adapter
  边界明确返回 unsupported。
- `tc agent test-hook` 现场测试当前安装；运行时只需返回宿主名、版本、各能力
  是否可用、测试时间和失败原因。
- Node Brief 明确写入当前宿主和已知能力。模型可以使用宿主暴露的工具，但不
  负责发现 Hook 是否安装或权限是否开启。
- `agent_runs` 以 `node_attempt_id` 为主关联，可选保存 session、turn、agent/run
  id。缺字段就留空，不增加补偿流程，也不把宿主 id 当成身份凭证。
- Taskcraft 在 Node Brief 中给出派发说明；Agent 有 subagent 工具就派发，没有
  就自己执行。Taskcraft 不创建 Dispatch 实体、不启动 subagent。

## Current Probe Decision

| 能力 | 2026-08-10 结论 |
| --- | --- |
| Codex SessionStart + Stop 连续执行 | `verified`，CLI `0.147.0` |
| Codex JSONL event 与 session/turn correlation | `verified` |
| Codex output schema 最终结果 | `limited`；两次上游 502，同期普通对照请求成功 |
| Codex subagent id correlation | `documented`；本次未执行 subagent 探针 |
| Claude SessionStart 和 hook event stream | `verified`，CLI `2.1.220` |
| Claude Stop/SubagentStop | `verified`；Agent 完成，Stop block 后同 session 继续并放行 |
| Claude structured result | `verified`；最终结果为 `{"status":"ok"}` |
| Claude session/agent correlation | `verified`；event stream 已观察到 session、agent id 和 agent type |

## Consequences

- 当前 Codex 和 Claude 采用 Hook-first 实现；无 Hook Agent 延后到真实接入时
  再设计。
- 用户打断始终有效。Stop Hook 只处理 Agent 的正常结束；中断后依靠 Task Store
  在下次会话恢复。
- Codex 当前上游不能被假设支持原生 output schema。Taskcraft 必须始终用本地
  Ajv 校验最终 JSON；原生 schema 只是可选宿主能力，失败时明确报错，不能把
  未校验文本当成成功结果。
- Claude 的 `--max-budget-usd` 会在原子调用已产生费用后检查，不能当成严格的
  预扣硬上限。
- 本机探针失败会保留为证据，而不是触发模拟成功或 silent fallback。

## Exit Cost

低。以后接入新宿主时增加 Adapter；只有出现真实需求时才增加新的能力字段。

## Contract Mapping

- architecture：host id 可扩展，Adapter 返回简单能力结果；`agent_runs` 只保存
  observation。
- CLI：`tc agent test-hook` 输出当前测试结果。
- Watch：显示当前能力和失败原因，不展示研究证据链。

## Task 01 Input

Task 01 不实现 Adapter 或能力探针。Task 04 实现 Codex/Claude Hook 安装和现场
测试；所有 Agent 结果仍在 Taskcraft 写入边界通过本地 Ajv 验证。

## Evidence

- [Codex Hooks](https://learn.chatgpt.com/docs/hooks)
- [Codex exec](https://learn.chatgpt.com/docs/developer-commands#codex-exec)
- [Codex Structured Outputs](https://developers.openai.com/cookbook/examples/codex/build_code_review_with_codex_sdk#codex-structured-outputs)
- [Claude Code Hooks](https://code.claude.com/docs/en/hooks)
- [Claude Code CLI](https://code.claude.com/docs/en/cli-reference)
- [Claude Code Subagents](https://code.claude.com/docs/en/sub-agents)
- `development/research/host-feasibility.md`
