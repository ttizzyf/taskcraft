# 任务 03：L2 Tracked 与 Review 回流

## 目标

实现 `frame -> execute -> delivery review -> record` 闭环，并用独立节点、attempt 和 reviewed attempt 关系表达 Review 与三级回流。

## 依赖

- 任务 02 完成。
- Review purpose、actor disclosure 和 R1/R2/R3 合同已经冻结。

## 必读输入

- `development/specs/lifecycle.md` 的 L2 与 Review 回流章节
- `development/specs/cli.md` 的 Review 命令
- `development/specs/architecture.md` 的 Review runtime facts
- `development/contracts/storage.sql`

## 范围

1. L2 frame、execute、review、record 内置图和 obligations。
2. review link、review purpose、reviewed_attempt_id、capability 和 independence status。
3. `passed` 与 evidence gate。
4. R1 `passed_with_fix`，保留 Reviewer 修复摘要、diff/evidence 和验证。
5. R2 在当前 revision 创建 focused Execute successor。
6. R3 创建新 lifecycle revision，冻结旧运行 attempt 并保留证据。
7. Review finding、resolution 和 history 查询。

## 交付物

- L2 与 Review CLI 纵切。
- pass、R1、R2、R3、same-actor、unverified 和缺 evidence fixtures。
- Review 回流的 reducer/transaction 测试。
- 可回放的 L2 实际样本。

## 验收标准

- Execute 与 Review 永远是不同节点和 attempt。
- 每个 Review 明确指向当前 revision 的一个可审核 attempt。
- same-actor 不能伪装成 observed-distinct。
- R1 一次修复后仍失败必须升级 R2。
- R2 不改变 scope/contract；R3 必须记录新合同、reason 和 diff。
- done 仍只由当前 required obligations 与 record 推导。

## 非目标

- 不实现 L3 Feasibility Review。
- 不证明宿主级强身份，只准确披露已观察能力。
- 不实现完整 Web UI。

## 验证

1. Review link、resolution 和 evidence 合同测试。
2. R1/R2/R3 reducer 与事务测试。
3. CLI 集成测试。
4. context-only/manual-attach smoke。

## 后续启动提示

任务标题：`Implement L2 tracked workflow and review feedback`

实现 Agent 与检查 Agent 必须分开。检查不能只覆盖最终 diff，还要验证旧 attempt、finding、successor 和 revision 是否都可查询。
