# Hook wiring and agent commands

## Goal

把 adapter 接成可用的接管链路：静默入口 gate、Entry/Stop Hook 安装、
`tc init --agent` / `tc enable` / `tc agent` 命令、agent_runs 观察与
diagnostics。全部本地可测，不依赖真实宿主调用。

## Requirements

### REQ-01. Silent Entry Gate

`src/hooks/entry.ts`：`off` → 零输出；无 active task（普通问答）→ 零输出；
`ask` + durable request → 输出一次建卡询问；`always` → 建卡 + anchor；
active task → 紧凑 breadcrumb（task anchor + 节点 + 唯一 next）。判定为
可测纯函数。

### REQ-02. Stop Hook Logic

`src/hooks/stop.ts`：投影 waiting/done/cancelled → allow；active 且有
runnable/running node → block + 输出 next 命令；`stop_hook_active` 防自循环
（宿主协议自带时忽略，脚本内不重复 block 同一 turn）。

### REQ-03. Hook Installation

`tc init --agent codex|claude` 生成 `.taskcraft/hooks/` 脚本并注册到项目级
配置（codex: 项目 session/config；claude: `.claude/settings.json` 项目级）；
幂等、不覆盖已有内容；`tc enable off|ask|always` 写 `.taskcraft/config.json`
（off 必须零 Hook 输出）；**绝不写全局宿主配置**（代码层断言）。

### REQ-04. Agent Commands

`tc agent capabilities`：当前宿主名/版本/能力清单（消费 adapter
capabilities()）；`tc agent test-hook`：现场测试（临时配置 + 真实宿主或
注入的 fake host，60s 超时），返回测试时间与失败原因。

### REQ-05. Diagnostics

Hook 缺失/失效/malformed/超时/未信任项目 → `TC_ADAPTER_*` 稳定错误进
diagnostics 输出（code/problem/impact/remediation），不静默伪装成功。

### REQ-06. Tests

entry/stop 判定矩阵（off/普通问答/active/waiting/done/cancelled）、
install 幂等与不覆盖、enable 状态切换与零输出、agent 命令输出与失败路径、
diagnostics、全局配置零写入断言。

## Acceptance Criteria

- [ ] 普通问答、`off` 与无 durable task 零注入、零任务写入。
- [ ] active task 只注入定位信息与唯一 next。
- [ ] `enable off` 后 Hook 零输出。
- [ ] Hook 失败显式进 diagnostics，不静默伪装成功。
- [ ] 全局宿主配置零改动（测试断言）。
- [ ] 新增文件有效行 ≤ 400；`pnpm check` 全绿。

## Non-goals

- 不执行真实宿主调用（host-smoke 子任务）；不改 adapters 接口。
- 不实现 L3/Watch/远程 CI。

## Notes

- 依赖已归档的 adapter-core；判定逻辑与 CLI 接线以父 design.md 为权威。
