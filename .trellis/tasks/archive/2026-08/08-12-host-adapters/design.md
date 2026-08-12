# Design: Codex and Claude adapters with continuation

## Structural Judgment

三个子任务按依赖顺序：adapter-core（纯代码）→ hook-wiring（命令与安装）→
host-smoke（真实宿主）。core 不依赖 CLI；hook 安装只写项目级/临时配置。

## Module Shape

```text
src/
  adapters/
    types.ts            # HostAdapter 接口、AdapterCapabilities、HookTestResult、
                        #   InstallResult、NodeBriefInput、AttachInput 类型
    codex.ts            # Codex adapter（capabilities/installEntry/testHook/
                        #   renderNodeBrief/attachObservation）
    claude.ts           # Claude adapter（同构）
  hooks/
    entry.ts            # 静默入口 gate：off/ask/always 判定 + breadcrumb 注入
    stop.ts             # Stop hook 逻辑：projector 判定 block/allow
  commands/
    init.ts             # 扩展 --agent codex|claude（hook 安装）
    enable.ts           # tc enable off|ask|always（写 .taskcraft/config.json）
    agent.ts            # tc agent capabilities / test-hook
  core/
    node-brief.ts       # 纯数据 Node Brief 渲染（Task 02 run 输出的宿主格式版）
```

依赖方向：adapters → core/store；commands → adapters/core；hooks → adapters/
core/commands（tc state --breadcrumb 等价逻辑内联，不 spawn 自身）。

## HostAdapter Contract（types.ts，与 architecture.md §9 对齐）

```ts
interface HostAdapter {
  id: "codex" | "claude";
  capabilities(): AdapterCapabilities;   // { host, version, items: { name,
    //   available: boolean, limitation?: string }[] , testedAt? }
  installEntry(input: InstallInput): InstallResult;  // 项目级/临时配置
  testHook(input: HookTestInput): HookTestResult;    // 真实宿主 60s 超时
  renderNodeBrief(input: NodeBriefInput): NodeBrief; // 宿主可读格式
  attachObservation?(input: AttachInput): HostRun;
  observe?(run: HostRun): RuntimeObservation;
}
```

- `capabilities()`：只读探针（`codex --version` / `codex features list` /
  `claude --version` / `claude --help` 解析），探针失败 → available=false +
  limitation=失败原因；不假设能力存在。
- `testHook()`：写临时 session 配置（临时目录，不动全局/项目生产配置），
  spawn 真实宿主最小 prompt（如 "Reply exactly TC_FIRST."），观察 Entry 注入
  与 Stop block/allow；60s 硬超时；结果含 testedAt 与失败原因。
- `renderNodeBrief()`：把 Task 02 run 返回的纯数据 Node Brief（objective、
  obligations、result schema、登记命令）渲染为文本块 + 可选 JSON；只消费
  projector/reducer 输出。

## Hook Wiring

- **安装目标**：`.taskcraft/hooks/` 下生成极薄脚本（`entry.sh` / `stop.sh`），
  `config.json` 记录 `{ takeOver: "off"|"ask"|"always", agents: [...] }`；
  Codex 项目配置（`codex/config.toml` 或 session config）与 Claude 项目配置
  （`.claude/settings.json` 项目级）注册 hook 命令指向这些脚本。
  **绝不写全局 `~/.claude/settings.json` 或 `~/.codex/`**。
- **entry.sh**：读 config → off → 零输出；ask/always → 读
  `tc state --breadcrumb`（等价逻辑：projector 投影 active task）→ 无任务/
  普通问答 → 零输出；active → 输出紧凑 breadcrumb 行。
- **stop.sh**：读 breadcrumb → waiting/done/cancelled → allow；active 且有
  runnable/running node → block + 输出 next 命令（`stop_hook_active` 防自循环，
  由宿主协议自带或脚本内判定）。
- **diagnostics**：hook 脚本 malformed JSON / 超时 / 宿主不可用 →
  `TC_ADAPTER_*` 错误进 `tc agent test-hook` 输出与 diagnostics 段；
  不静默伪装。

## Silent Entry Gate（product.md §6 映射）

```text
config.takeOver = off                        -> silent
普通问答/无 durable task（无 active task）    -> silent
ask + durable request                        -> 问一次是否建卡
always + durable request                     -> 建卡 + 注入 anchor
active task                                  -> 注入 breadcrumb（task anchor +
                                               节点 + 唯一 next）
```

判定逻辑放 hooks/entry.ts（可测试的纯函数 + 少量 IO），不 spawn CLI 自身。

## Agent_runs Observation

- `attachObservation`：写 `agent_runs`（host/host_run_id/host_session_id/
  observation_status/observation_json）；字段可选，缺失留空。
- `observe`：由 stop/entry 事件更新 last_seen/status（pending/running/
  stale/finished/failed/unsupported）；**永不把 finished 当作任务完成**
  （projector 不读 agent_runs——已由 Task 02/03 保证）。

## Error Taxonomy（新增）

| code | 场景 | remediation |
| --- | --- | --- |
| `TC_ADAPTER_UNSUPPORTED` | host 非 codex/claude | `tc init --agent codex\|claude` |
| `TC_ADAPTER_HOOK_INSTALL_FAILED` | 项目配置写入失败 | 检查 .taskcraft/ 权限 |
| `TC_ADAPTER_HOOK_TEST_FAILED` | test-hook 失败/超时/malformed | 查看 diagnostics 原因 |
| `TC_ADAPTER_CAPABILITY_PROBE_FAILED` | 只读探针失败 | 检查宿主安装/登录 |

## Conformance Suite

- 每个 adapter 的合同测试：capabilities 形状、installEntry 幂等（临时目录）、
  testHook 用 fake host 命令（spawn 桩脚本）验证超时/malformed/失败路径、
  renderNodeBrief 同源。
- 共享 conformance 驱动（同一测试集跑 codex/claude 两个实现），证明
  "两宿主共享合同不共享实现"。

## Compatibility & Rollback

- 只增改 src/ 与新增 fixtures/样本记录；冻结文件不动。
- 真实宿主调用只在 host-smoke 子任务、逐次授权后执行。
- 每子任务完成 `pnpm check` 全绿为提交门槛。
