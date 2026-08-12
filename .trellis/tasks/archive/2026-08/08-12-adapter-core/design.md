# Design: HostAdapter core and conformance

## Interfaces

```ts
// types.ts
export interface AdapterCapabilities {
  host: string;                    // "codex" | "claude"
  version: string | null;          // 探针失败时 null
  items: Array<{
    name: "session-start" | "stop" | "structured-output" | "run-correlation";
    available: boolean;
    limitation?: string;           // 失败原因 / limited 说明
  }>;
  testedAt?: string;               // test-hook 时间
}

export interface InstallInput { projectDir: string; takeOver: "off" | "ask" | "always"; }
export interface InstallResult { ok: boolean; hookPaths: string[]; limitation?: string; }

export interface HookTestInput { projectDir: string; timeoutMs?: number; }
export interface HookTestResult {
  ok: boolean; entryInjected: boolean; stopEnforced: boolean;
  testedAt: string; failure?: string; sample?: string;
}

export interface HostAdapter {
  id: "codex" | "claude";
  capabilities(): AdapterCapabilities;
  installEntry(input: InstallInput): InstallResult;
  testHook(input: HookTestInput): HookTestResult;
  renderNodeBrief(input: NodeBriefInput): NodeBrief;
  attachObservation?(input: AttachInput): HostRun;
  observe?(run: HostRun): RuntimeObservation;
}
```

## 实现要点

- **capabilities**：同步只读探针（execFileSync，2s 超时），解析版本与
  features/help 文本；解析失败 → `{ available: false, limitation: stderr }`，
  不抛异常（capabilities 永不 crash 命令）。
- **installEntry**：`projectDir/.taskcraft/hooks/{entry,stop}.sh` 模板脚本
  （bash，调用 node 解析 breadcrumb 或调用 `tc state --breadcrumb` 等价逻辑
  ——本子任务只生成脚本骨架，具体逻辑 hook-wiring 填充，模板引用
  `node <tc-path> state --breadcrumb`）；项目级配置注册（codex: session
  config 或 config.toml；claude: `.claude/settings.json` 项目级）——本子任务
  交付写配置的纯函数（输入配置对象，输出更新后对象 + 写盘），真实安装测试
  在 hook-wiring 验证。
- **testHook**：临时目录写最小配置 → spawn 宿主最小 prompt → 解析 stdout
  （Entry 注入 marker、Stop block/allow 判定）；超时/非零退出 → ok=false +
  failure。fake host 桩（测试注入 spawnCommand）覆盖所有失败路径。
- **renderNodeBrief**：纯函数——Node Brief 数据 → 文本块（标记代码块）与
  JSON（直接透传数据 + 宿主头），无 IO。
- **attachObservation**：写 agent_runs 行（复用 query/store 写路径的
  withTransaction），字段可选。

## Conformance

`tests/adapters/conformance.ts` 导出 `runConformance(adapter)`；两个测试文件
分别注入 codex/claude 实例 + fake host 桩；断言集合共享。
