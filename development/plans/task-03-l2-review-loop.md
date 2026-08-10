# 任务 03：L2 Tracked 与 Review 回流

## 目标

实现 `frame -> execute -> delivery review -> record` 闭环，并用独立节点、attempt、
reviewed attempt 关系和三个 outcome 表达 Review 回流。

## 依赖

- 任务 02 完成。
- Review purpose、独立性披露和三个 outcome 合同已经冻结。

## 必读输入

- `development/specs/lifecycle.md` 的 L2 与 Review 回流章节
- `development/specs/cli.md` 的 Review 命令
- `development/specs/architecture.md` 的 Review runtime facts
- `development/contracts/storage.sql`

## 范围

1. L2 frame、execute、review、record 内置图和 obligations。
2. review link、review purpose、reviewed_attempt_id、capability 和 independence status。
3. `passed` 与 evidence gate。
4. Reviewer 修改内容时保留 diff/evidence 和验证，outcome 仍为 `passed`。
5. `changes_requested` 在当前 revision 创建 focused Execute successor。
6. `replan_required` 创建新 lifecycle revision，冻结旧运行 attempt 并保留证据。
7. Review finding、outcome 和 history 查询；不建立 resolution 表。

## 交付物

- L2 与 Review CLI 纵切。
- passed、changes_requested、replan_required、same-actor、unverified 和缺 evidence fixtures。
- Review 回流的 reducer/transaction 测试。
- 可回放的 L2 实际样本。

## 验收标准

- Execute 与 Review 永远是不同节点和 attempt。
- 每个 Review 明确指向当前 revision 的一个可审核 attempt。
- same-actor 不能伪装成 observed-distinct，但不硬性阻止 Review。
- `changes_requested` 不改变 scope/contract；`replan_required` 必须记录新合同、
  reason 和 diff。
- done 仍只由当前 required obligations 与 record 推导。

## 非目标

- 不实现 L3 Feasibility Review。
- 不证明宿主级强身份，只准确披露已观察能力。
- 不实现完整 Web UI。

## 验证

1. Review link、outcome 和 evidence 合同测试。
2. 三种 outcome 的 reducer 与事务测试。
3. CLI 集成测试。
4. context-only/manual-attach smoke。

## 后续启动提示

任务标题：`Implement L2 tracked workflow and review feedback`

有独立检查 Agent 时优先使用；没有时当前 Agent 自审并记录 `same-actor`。检查不能
只覆盖最终 diff，还要验证旧 attempt、finding、successor 和 revision 是否都可查询。
