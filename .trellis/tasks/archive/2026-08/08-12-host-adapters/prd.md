# Implement Codex and Claude adapters with continuation

## Goal

让 Codex 与 Claude Code 能从同一 Task Store 恢复任务、领取 Node Brief、
连续执行 next，并准确披露宿主能力与限制：两个 HostAdapter、Entry/Stop Hook
安装与现场测试、静默入口 gate、diagnostics 与真实宿主 smoke 记录。

## Background

- 来源需求是 `development/plans/task-04-host-adapters.md`；宿主能力证据见
  `development/research/host-feasibility.md`（Codex 0.147.0 / Claude 2.1.220，
  SessionStart/Stop Hook 均 verified；Codex 原生 structured output limited）。
- Task 01-03 已完成：reducer/projector/CLI 就位，Node Brief 已有纯数据版
  （`run` 输出），breadcrumb 已按 schema 构造。
- 已冻结且不得改动：storage.sql、schemas、既有 fixtures、specs/、plans/。
- 用户已确认：父 + 3 子任务（adapter-core / hook-wiring / host-smoke）；
  宿主 smoke 边界 = 项目级/临时配置 + 真实调用逐次授权 + 只读探针自动跑，
  绝不改全局 `~/.claude/` / `~/.codex/` 配置。
- 五级能力状态（verified/documented/...）是研究方法，产品运行时只输出
  当前能力、测试时间与失败原因；`tc agent capabilities` 与 research 报告
  分离。

## Requirements

### REQ-01. HostAdapter Interface & Implementations

按 architecture.md §9 的 contract 实现 `HostAdapter`（capabilities /
installEntry / testHook / renderNodeBrief / attachObservation / observe），
codex 与 claude 两个实现；host 值是开放字符串，不建立 Adapter registry。
两宿主共享同一合同与 Node Brief/breadcrumb 数据源，不共享宿主特定实现细节。

### REQ-02. Capabilities Query

`capabilities()` 返回当前宿主名/版本/能力清单（SessionStart/Stop Hook、
结构化输出、run correlation）与失败原因；能力证据来自本机只读探针
（--version/help/features/agents 等），探针失败返回显式失败原因，不假装
能力存在。

### REQ-03. Hook Installation（项目级/临时配置）

`installEntry` 在项目级 `.taskcraft/` 配置（或临时 session 配置）安装
Entry（SessionStart/UserPromptSubmit）与 Stop Hook，极薄入口（静默 gate +
`tc state --breadcrumb` 等价调用）；`enable off` 必须零输出；已存在时幂等，
不覆盖用户内容；**绝不写全局宿主配置**。

### REQ-04. Node Brief & Breadcrumb Integration

`renderNodeBrief` 把 Task 02 的纯数据 Node Brief 渲染为宿主可读格式
（含宿主名、已知能力、派发说明、本地 result schema 与登记命令）；breadcrumb
按已有 schema 注入。渲染只消费 projector/reducer 输出，无第二套推导。

### REQ-05. Silent Entry Gate

`off` / 普通问答 / 无 durable task → 零 Hook 输出、零 Task Store 写入；
active task 只注入 task anchor、当前节点与唯一 next，不倾倒完整上下文；
检测到 durable execution 且 ask 模式时只问一次是否建卡。

### REQ-06. Hook Test & Diagnostics

`tc agent test-hook` 现场测试 Entry/Stop（临时配置运行真实宿主，60s 超时）；
Hook 缺失、失效、超时、malformed JSON 与未信任项目 → 显式 diagnostics
输出（code/problem/impact/remediation），不静默伪装成功。只有真实 Stop
smoke 通过的宿主才报告 Stop Hook `enforced`，其余 `advisory`。

### REQ-07. Agent Commands

`tc init --agent codex|claude`、`tc enable off|ask|always`、`tc agent
capabilities`、`tc agent test-hook`；`agent capabilities` 输出当前宿主名、
版本与各项能力是否可用；`agent test-hook` 返回测试时间与失败原因。

### REQ-08. Run Observation Boundary

`attachObservation` / `observe` 把宿主 session/run/agent id 写为
`agent_runs` observation（可选字段，缺失留空，不建补偿系统）；observation
永不直接完成任务（`agent_runs` 不参与 projector 推导）。

### REQ-09. Real-host Smoke & Records

Gate H1 六类样本（ordinary / off / active / waiting / done / timeout /
malformed hook）在真实宿主上执行并记录：zero-injection、anchor-only
injection、Stop 连续执行、用户中断后从 Task Store 恢复。smoke 边界：
项目级/临时配置，付费调用逐次授权，只读探针自动跑。记录文件区分
"文档支持"与"本机真实验证"（沿用 host-feasibility.md 的规则）。

### REQ-10. Non-goals

- 不自动选择模型、不启动/调度 subagent、不依赖 L3/Watch。
- 不建立 Adapter registry、能力证据实体或有效期系统。
- 无 Hook Agent（不支持 Hook 的宿主）延后适配。

## Acceptance Criteria

- [ ] 普通问答、`off` 与无 durable task 时零注入、零任务写入。
- [ ] active task 只注入定位信息与唯一 next，不倾倒完整上下文。
- [ ] 只有真实 Stop smoke 通过的宿主才声明 Stop Hook 可用（enforced/advisory）。
- [ ] observation 的 finished 不会直接把 Task 标记 done。
- [ ] Hook 失败显式进入 diagnostics，不静默伪装成功。
- [ ] 结果写入前本地 Ajv 校验；原生结构化输出失败时不把未校验文本当成功。
- [ ] 两宿主共享 Taskcraft 合同，不共享宿主特定实现细节。
- [ ] 全局宿主配置零改动（smoke 只用项目级/临时配置）。
- [ ] 新增文件有效行 ≤ 400；`pnpm check` 全绿；`git diff --check` 干净。

## Child Task Map

| 子任务 | 交付物 | 独立可检查点 |
| --- | --- | --- |
| `adapter-core` | HostAdapter 接口、codex/claude 实现、capabilities、conformance suite | 合同实现完整；能力查询显式失败；conformance 通过 |
| `hook-wiring` | init --agent / enable / agent 命令、Hook 安装、Node Brief 集成、agent_runs 观察、diagnostics、静默 gate | 零注入零写入；diagnostics 显式；本地测试全绿 |
| `host-smoke` | 真实宿主六类样本、smoke 记录、中断恢复样本 | 记录区分文档/实测；enforced/advisory 如实披露 |

依赖顺序：`adapter-core` → `hook-wiring` → `host-smoke`；父任务负责接口一致性
与最终验收。

## Notes

- 规划从真实宿主路径反推：先定 Hook 注入/测试边界与能力披露规则，再拆实现。
- 子任务在各自 prd/design/implement 中细化；本文件是源需求集。
