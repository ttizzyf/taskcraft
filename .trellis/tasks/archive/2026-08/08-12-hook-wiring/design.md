# Design: Hook wiring and agent commands

## Entry Gate（纯函数）

```ts
// hooks/entry.ts
type EntryDecision =
  | { kind: "silent" }                          // off / 无 active task / 普通问答
  | { kind: "ask-create"; taskAnchor: null }
  | { kind: "create-and-anchor"; ... }
  | { kind: "inject"; breadcrumb: BreadcrumbV1; next: string };

export function decideEntry(
  takeOver: "off" | "ask" | "always",
  projection: Projection | null,     // active task 投影（无则 null）
  durableRequest: boolean,           // 调用方（CLI/hook 包装）判定
): EntryDecision;
```

Hook 脚本只做 IO：读 config.json → 查 active task（复用 query+project）→
调 decideEntry → 按 decision 输出/静默。不 spawn `tc` 自身。

## Stop Logic（纯函数）

```ts
export function decideStop(projection: Projection | null): "allow" | {
  action: "block"; next: string;
};
// waiting/done/cancelled/无任务 -> allow；active 且有 runnable/running ->
// block + next 命令
```

## Commands

- `tc init --agent <codex|claude>`：mkdir .taskcraft/hooks → 写 entry.sh /
  stop.sh（模板引用 `node <package bin>` 的等价逻辑——直接内联调用 node
  脚本，避免依赖 cwd）→ 项目级配置注册（纯函数 `writeProjectConfig`，
  测试用临时目录）→ 输出已安装 hook 路径。`TC_ADAPTER_UNSUPPORTED` 对未知
  agent。
- `tc enable off|ask|always`：读-改-写 config.json（原子写 tmp+rename）；
  off 时验证 entry/stop 脚本输出为空（模拟判定）。
- `tc agent capabilities`：spawn 只读探针 → 输出表格/JSON（复用 adapter）。
- `tc agent test-hook`：临时目录 installEntry → testHook（fake host 可注入）
  → 输出 ok/enforced-advisory + testedAt + failure。

## Diagnostics

`TC_ADAPTER_HOOK_INSTALL_FAILED` / `TC_ADAPTER_HOOK_TEST_FAILED` /
`TC_ADAPTER_CAPABILITY_PROBE_FAILED` / `TC_ADAPTER_UNSUPPORTED` 映射到
TaskcraftError；`agent test-hook` 失败输出三件套。

## Tests

- decideEntry/decideStop 判定矩阵（含 waiting/done/cancelled/timeout 边界）。
- install：临时目录幂等、不覆盖用户已有 config 内容、全局配置零写入断言
  （spy 检查不触碰 HOME 下路径）。
- enable：状态切换、off 零输出、原子写。
- agent 命令：fake host 成功/失败/超时路径、输出形状。
