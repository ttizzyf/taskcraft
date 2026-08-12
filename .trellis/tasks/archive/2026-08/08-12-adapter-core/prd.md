# HostAdapter core and conformance

## Goal

交付 HostAdapter 接口、codex/claude 两个实现、能力查询与 conformance suite
（纯代码，不含真实宿主调用）。

## Requirements

### REQ-01. HostAdapter Interface

`src/adapters/types.ts`：`HostAdapter`（id / capabilities / installEntry /
testHook / renderNodeBrief / attachObservation? / observe?）与全部输入输出
类型，与 architecture.md §9 对齐。

### REQ-02. Codex & Claude Implementations

`src/adapters/codex.ts` / `claude.ts`：
- capabilities：只读探针（--version / features list / --help / agents --json
  ），探针失败 → available=false + limitation=失败原因，不假设能力存在。
- installEntry：写 `.taskcraft/hooks/` 脚本 + 项目级配置注册；幂等；
  **绝不写全局宿主配置**。
- testHook：临时 session 配置 + spawn 宿主最小 prompt，60s 硬超时；支持
  fake host 桩（测试注入）验证超时/malformed/失败路径。
- renderNodeBrief：消费 Task 02 纯数据 Node Brief，渲染宿主可读格式。
- attachObservation/observe：host run 观察（可选字段，缺失留空）。

### REQ-03. Node Brief Rendering

`src/core/node-brief.ts`：把 run 返回的 Node Brief 数据（objective /
obligations / result schema / 登记命令 / 宿主与已知能力）渲染为文本块与
JSON 两种宿主格式；只消费 projector/reducer 输出。

### REQ-04. Conformance Suite

同一 conformance 驱动跑 codex/claude 两实现：capabilities 形状与失败路径、
installEntry 幂等（临时目录）、testHook fake-host 超时/malformed/失败、
renderNodeBrief 同源、attachObservation 写 agent_runs。

## Acceptance Criteria

- [ ] 两实现通过同一 conformance suite（共享合同，不共享实现细节）。
- [ ] capabilities 探针失败返回显式失败原因，不假装能力存在。
- [ ] installEntry 幂等且不覆盖已有内容；不写全局配置。
- [ ] testHook 60s 超时与 malformed 路径显式失败。
- [ ] 新增文件有效行 ≤ 400；`pnpm check` 全绿。

## Non-goals

- 不接真实宿主（host-smoke 子任务）；不实现 CLI 命令（hook-wiring）。
- 不建立 Adapter registry 或能力证据实体。

## Notes

- 依赖已归档的 core/store（Node Brief 数据、projector、agent_runs 查询）。
- 语义以父 design.md（Module Shape / Contract / Conformance）为权威。
