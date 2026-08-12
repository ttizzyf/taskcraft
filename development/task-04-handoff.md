# Task 04 交接说明（Host Adapter 已完成）

> 更新日期：2026-08-12。本文件是给新会话 agent 的交接文档：Task 04（Codex/Claude
> Adapter 与连续执行）已完成并归档，新 agent 应先读本文件了解现状与约束，再开始
> Task 05（L3 子任务与 Integrate）。Task 02/03 交接见 `task-02-handoff.md` /
> `task-03-handoff.md`（工程基础与 Review 决策仍适用）。

## 一、当前状态

- **仓库**：Taskcraft，`main` 分支。
- **Task 01-04 已完成、已提交、已归档**（`.trellis/tasks/archive/2026-08/`）。
- **无活动 Trellis 任务**。Task 05 尚未创建。
- **上游产物**：contracts/、specs/、plans/ 冻结；本任务只新增了
  `development/host-smoke-2026-08.md`（研究证据，非产品合同）。
- `development/plans/roadmap.md` 状态列已更新（Task 01-04 完成）。

## 二、Task 04 已完成的内容

```text
src/adapters/types.ts              # HostAdapter 接口与全部输入输出类型
src/adapters/shared.ts             # 共享机制：safeProbe / installEntryFiles
                                   #   （write-if-absent 幂等）/ runHookTest /
                                   #   resolveTcPath（dist 路径解析）/
                                   #   attachObservation / hook 模板
src/adapters/codex.ts              # codex adapter（capabilities 只读探针 /
                                   #   .codex/config.toml / exec --json test-hook）
src/adapters/claude.ts             # claude adapter（--help 探针 /
                                   #   .claude/settings.json / -p test-hook）
src/core/node-brief.ts             # Node Brief 纯数据渲染（宿主格式）
src/hooks/entry.ts                 # 静默入口 gate：decideEntry 矩阵 +
                                   #   runEntryGate（无 task 零输出）
src/hooks/stop.ts                  # decideStop + decideStopForHook
                                   #   （stop_hook_active 防自循环）
src/commands/enable.ts             # tc enable off|ask|always（原子写 config.json）
src/commands/agent.ts              # tc agent capabilities / test-hook
src/commands/init.ts               # tc init --agent codex|claude（hook 安装）
tests/                             # 230+ 用例（adapters conformance 14×2、
                                   #   hooks 矩阵、CLI 集成）
development/host-smoke-2026-08.md  # 真实宿主 smoke 记录（verified/limited 分列）
```

**可复用入口**（Task 05 直接 import）：

- `resolveAgentAdapter(agent)` → codex | claude adapter。
- `adapter.capabilities()` / `adapter.testHook()` / `adapter.renderNodeBrief()`。
- `decideEntry` / `decideStop` / `decideStopForHook`（hook 判定纯函数）。
- `runEntryGate` / `runStopGate`（hook IO 包装，`node dist/hooks/{entry,stop}.js <config-path>`）。
- `tc agent capabilities` / `tc agent test-hook` / `tc enable` / `tc init --agent`。

## 三、关键工程决策（新 agent 必须遵守，勿回退）

Task 02/03 全部决策仍适用，新增：

1. **hook 脚本路径必须指向构建产物**：`dist/adapters` 下
   `new URL("../cli.js", import.meta.url)`（**一层父级**）→ `dist/cli.js`；
   `../../` 会落到包根导致 `<root>/hooks/entry.js` 不存在的静默失败。hook
   模板（`entry.sh`/`stop.sh`）引用 `dist/hooks/{entry,stop}.js`。测试断言
   必须用构建产物路径（spawn dist/cli.js 的集成测试），src 环境的
   conformance 断言用 `dirname(resolveTcPath())` 推导。
2. **Stop hook 必须实现 `stop_hook_active` 防自循环**：codex 与 claude 都会
   在第二次 Stop（同一 turn 的 re-entry）时把当前输入回传，输入 JSON 含
   `stop_hook_active: true`；hook 必须读 stdin 并放行（allow），否则宿主
   无限循环（实测 claude 17 次 block）。缺失此逻辑是真实缺陷，不是宿主
   协议职责。
3. **codex exec 非交互 hooks 行为异常**（S2 limited）：`codex exec --ephemeral`
   不加载项目级 `.codex/config.toml`（`-c` 只覆盖用户配置）；`-c` 传 hook
   亦未见执行，与 Task 00 探针 CX-02 记录矛盾。**codex Stop Hook 目前只声明
   advisory**，交互会话复验通过前不声明 enforced。claude 侧 enforced（S4
   实测注入 + block + loop guard）。
4. **真实宿主调用边界**：只读探针自动跑；付费调用逐次向用户确认；只改
   项目级/临时配置，**全局 `~/.codex/`、`~/.claude/` 配置零改动**（观察
   日志只读）。
5. **smoke 记录区分 verified/limited**：`development/host-smoke-2026-08.md`
   是研究证据，不进入产品数据模型；能力状态五级只在研究文档使用。
6. **全局配置零写入的测试要真实拦截 fs**：`vi.mock("node:fs")` 记录全部
   写路径断言在 projectDir 内（假阳性教训：只断言返回路径不够）。
7. **`tc init` 不写 config.json**：init 只装 hook 脚本 + 项目配置注册；
   takeover 模式由 `tc enable` 写 `.taskcraft/config.json`（默认 off →
   hook 零输出）。

## 四、验证命令（每次开发前后跑）

```bash
pnpm install --frozen-lockfile
pnpm check                       # test -> typecheck -> lint -> format:check -> build
git diff --check
node dist/cli.js agent capabilities
node dist/cli.js agent test-hook --agent claude   # 真实宿主 60s（付费，先确认）
```

## 五、Task 05 应该怎么做

1. **先读**：本文件 → `development/plans/roadmap.md` →
   `development/plans/task-05-l3.md` → `development/specs/lifecycle.md` §9.1
   （Feasibility Review）→ `development/specs/cli.md` §4（L3 闭环示例）。
2. **创建 Trellis 任务**（复杂任务，需完整 prd/design/implement，可拆子任务树）：
   目标预期：L3 图（frame → plan → feasibility review → execute → delivery
   review → integrate → record）、`task fact add` 命令（probe 事实）、
   `review --purpose feasibility`（审核 plan attempt）、integrate 节点与
   `review --purpose integration`。复用现有 reducer/projector/adapter：
   review 命令已按 purpose 分支（storage.sql trigger 已支持 feasibility/
   integration），L3 图是新的静态生命周期定义。
3. **开发流程**：`trellis-implement` → `trellis-check` → `trellis-update-spec`
   → 提交（conventional commits）→ `/trellis:finish-work` 归档。
4. **提交前**：`pnpm check` 全绿 + `git diff --check` 干净。
5. **沟通语言**：中文。
6. **不要**：改 Task 00-04 已冻结的 storage.sql、schemas、既有 fixtures、
   specs；不要提前加 Watch/远程 CI；不要引入 ORM/bundler/workspace；
   不要动全局宿主配置。
