# Implement: Codex and Claude adapters with continuation

## Execution Order

`adapter-core` → `hook-wiring` → `host-smoke` → 父任务集成验收。每个子任务
独立 start / check / commit / 归档。

## Ordered Checklist

### Phase A: adapter-core 子任务

1. `task.py start` 08-12-adapter-core。
2. `src/adapters/types.ts`：HostAdapter 接口与全部输入输出类型。
3. `src/adapters/codex.ts` / `claude.ts`：capabilities（只读探针，显式失败）/
   installEntry（项目级/临时配置，幂等）/ testHook（临时配置 + fake host
   桩可测）/ renderNodeBrief（同源）/ attachObservation。
4. `src/core/node-brief.ts`：纯数据 Node Brief 渲染（宿主格式）。
5. conformance suite：同一驱动跑两实现（合同测试 + fake host 失败路径）。
6. `pnpm check` 全绿 → 提交 → `trellis-check` → 归档。

### Phase B: hook-wiring 子任务

1. `task.py start` 08-12-hook-wiring。
2. `src/hooks/entry.ts` / `stop.ts`：静默 gate（off/ask/always + 普通问答）
   与 stop block/allow 判定（纯函数可测）。
3. `src/commands/init.ts` 扩展 `--agent`、新增 `enable.ts`（写
   .taskcraft/config.json）、`agent.ts`（capabilities / test-hook）。
4. Hook 安装：`.taskcraft/hooks/` 脚本生成 + 项目级配置注册；绝不写全局
   配置；`enable off` 零输出。
5. diagnostics：TC_ADAPTER_* 错误映射与输出。
6. tests：entry/stop 判定矩阵、install 幂等与不覆盖、enable 状态切换、
   agent 命令输出、diagnostics。
7. `pnpm check` 全绿 → 提交 → `trellis-check` → 归档。

### Phase C: host-smoke 子任务

1. `task.py start` 08-12-host-smoke。
2. Gate H1 六类样本真实执行（ordinary / off / active / waiting / done /
   timeout / malformed）：临时目录 + 项目级临时配置；付费调用逐次向用户
   确认；只读探针自动跑。
3. 中断恢复样本：用户中断后从 Task Store 恢复。
4. 记录：`development/` 下 host-smoke 记录文档，区分"文档支持"与"本机
   真实验证"；enforced/advisory 如实披露。
5. `pnpm check` 全绿 → 提交 → `trellis-check` → 归档。

### Phase D: 父任务集成验收

1. 核对父 prd.md Acceptance Criteria 逐条。
2. 更新 `task-03-handoff.md` 为 Task 04 交接状态；roadmap 状态列更新。
3. 父任务归档。

## Validation Commands

```bash
pnpm check
git diff --check
node dist/cli.js agent capabilities
```

## Review Gates

- 每子任务提交前：`pnpm check` 全绿 + `git diff --check` 干净 + trellis-check。
- 全局宿主配置零改动（smoke 只用项目级/临时配置）。
- 冻结文件出现 diff 时停止回 Plan。

## Rollback Points

- Phase A 接口问题：回 Plan 修正 design。
- Phase B 安装问题：只改 hooks/commands，不动 adapters。
- Phase C 真实宿主问题：跳过样本、记录失败原因，不修配置掩盖。
