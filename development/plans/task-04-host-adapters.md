# 任务 04：Codex/Claude Adapter 与连续执行

## 目标

让 Codex 与 Claude Code 能从同一 Task Store 恢复任务、领取 Node Brief、连续执行 next，并准确披露宿主能力和限制。

## 依赖

- 任务 03 完成。
- 任务 00 的宿主探针允许对相应能力作出声明；未验证项必须按 capability 状态降级。

## 必读输入

- `development/research/host-feasibility.md`
- `development/specs/architecture.md` 的 Adapter contract
- `development/specs/lifecycle.md` 的连续执行合同
- `development/specs/cli.md`

## 范围

1. Codex 与 Claude adapter 的 capability registry。
2. Entry Hook、Node Brief、breadcrumb 和 Stop/继续提示映射。
3. `continuationMode=advisory|enforced` 的真实能力披露。
4. context-only、manual-attach、host-observed 运行关联。
5. session/run/agent observation 与 Task facts 的明确边界。
6. active、waiting、done、cancelled、timeout 和 malformed hook 样本。
7. Hook 不可用时通过 `tc task next` 恢复的降级路径。

## 交付物

- 两个 adapter 实现和 conformance suite。
- Node Brief 与 breadcrumb Schema/fixture。
- `tc agent capabilities`、`test-hook` 和 diagnostics 输出。
- Codex 与 Claude 的真实宿主 smoke 记录。

## 验收标准

- 普通问答、off 和无 durable task 时零注入、零任务写入。
- active task 只注入定位信息和唯一 next，不倾倒完整上下文。
- 只有真实 Stop smoke 通过的宿主才能声明 enforced。
- observation 的 finished 不会直接把 Task 标记 done。
- Hook 失败显式进入 diagnostics，不静默伪装成功。
- 两个宿主共享 Taskcraft 合同，不共享宿主特定实现细节。

## 非目标

- 不自动选择模型。
- 不让 Taskcraft 启动或调度 subagent。
- 不依赖完整 L3 或 Watch。

## 验证

1. Adapter contract tests。
2. Codex/Claude conformance tests。
3. ordinary/off/active/waiting/done/timeout 真实 smoke。
4. advisory 恢复路径 smoke。

## 后续启动提示

任务标题：`Implement Codex and Claude adapters with continuation`

本任务先完成只读宿主探针和设计评审，再实现 adapter。最终报告必须把“文档支持”和“本机真实验证”分开陈述。
