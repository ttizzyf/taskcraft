# Task 03 交接说明（L2 Review 环已完成）

> 更新日期：2026-08-12。本文件是给新会话 agent 的交接文档：Task 03（L2 Tracked
> 与 Review 回流）已完成并归档，新 agent 应先读本文件了解现状与约束，再开始
> Task 04（Host Adapter）。Task 02 的交接见 `task-02-handoff.md`（工程基础与
> L1 决策仍适用）。

## 一、当前状态

- **仓库**：Taskcraft，`main` 分支。
- **Task 01-03 已完成、已提交、已归档**（`.trellis/tasks/archive/2026-08/`）。
- **无活动 Trellis 任务**。Task 04 尚未创建。
- **上游产物**：`development/contracts/`（storage.sql、schemas、fixtures）与
  `development/specs/` 冻结；Task 02/03 只在 `contracts/fixtures/` 新增了
  L1/L2 运行时 fixture，未改动任何既有文件。
- `development/plans/roadmap.md` 状态列已更新（Task 01-03 完成）。

## 二、Task 03 已完成的内容

```text
src/core/lifecycle/l2.ts            # L2 内置图：frame-1 -> execute-1 -> review-1
                                    #   -> record-1；frame result schema
                                    #   （objective/scope/acceptance）
src/core/reducer/l2-materialize.ts  # L2 图物化（taskNew/reviewReplan 共用）
src/core/reducer/review-shared.ts   # review 引用校验/link/finding/supersede 辅助
src/core/reducer/review-start.ts    # reviewStart：attempt+link+独立性披露
src/core/reducer/review-pass.ts     # reviewPass：evidence gate + obligation 满足
src/core/reducer/review-changes.ts  # reviewChanges：blocking finding + successor
src/core/reducer/review-replan.ts   # reviewReplan：新 revision + supersede 原子事务
src/commands/review*.ts             # tc review start/pass/changes/replan
development/contracts/fixtures/     # +l2-pass / review-changes-requested /
                                    #   review-replan-required / review-same-actor /
                                    #   review-unverified / review-missing-evidence
development/l2-review-sample.md     # 可回放样本：passed / changes / replan 三路径
tests/                              # 140 用例
```

**可复用入口**（Task 04 直接 import，Task 02 入口仍可用）：

- `taskNew` 支持 `level: 1 | 2`（level 3 仍 `TC_TASK_LEVEL_UNSUPPORTED`）。
- `reviewStart/reviewPass/reviewChanges/reviewReplan`（`src/core/reducer.ts`）。
- `project()` 的 next 已按 node kind 生成 review start/pass 命令。
- `getReviewLinks/getReviewFindings`（query model）+ `task show` 已展示
  全部 revision attempts（superseded 可见）与 findings。

## 三、关键工程决策（新 agent 必须遵守，勿回退）

Task 02 的全部决策仍适用（record 物化、Commander 同名选项、getLastEventSeq、
`--facts` 持久化、CAS/事务模式），新增：

1. **attempt id 与 attempt_number 按节点全局递增**：`node_attempts.id` 是
   全局 TEXT 主键，编号只按当前 revision 计算会在 replan 后撞主键。编号跨
   revision 全局单调递增（新 revision 不从 1 复位）；`UNIQUE(task_id,
   lifecycle_revision, node_id, attempt_number)` 依然成立（同 revision
   不可能同号）。**writeRecordResult 的 attemptNumber 必须与全局 id 一致**
   （硬编码 1 会在同 revision 二次 record 写入时撞 UNIQUE）。
2. **satisfyObligation 幂等 no-op**：`obligation_results` 主键是
   (task_id, lifecycle_revision, node_id, obligation_id)，changes 流
   successor 重做 execute 时同义务已满足，重复 INSERT 必撞主键——满足前
   SELECT 预检，已存在则 no-op。唯一被吞场景就是"本 revision 本节点本义务
   已满足"；错 revision 会插新行而非 no-op，不掩盖真实错误。
3. **reviewChanges/reviewReplan 必须完结 review attempt**：changes →
   finished/changes_requested，replan → superseded（由 supersede 逻辑处理）。
   若不完结，review-1 永远有 running attempt，后续无法再 review start，
   闭环死锁。Review 只使用三个 outcome（passed/changes_requested/
   replan_required），与 lifecycle.md §9.2 一致。
4. **reviewReplan 审计事件引用旧 revision**：events 复合 FK
   (attempt_id, task_id, lifecycle_revision, node_id) 要求与 attempt 精确
   匹配，replan 事件必须引用旧 revision 的 review attempt。
5. **projector 节点状态 running 优先于 satisfied**：changes 后 execute-1
   同时存在 finished/success 旧 attempt 与 created successor——必须投影
   running（next 指向 `tc run complete`），否则 next 落到旧 attempt 死胡同。
6. **`run` 拒绝 review 节点**：review 节点只能经 `tc review start` 创建
   attempt；`run --node review-1` 返回 `TC_ATTEMPT_REF_INVALID`（run claim
   会产生无 review link 的 attempt，projector 的 reviewPassCommand 会崩溃）。
7. **`review start` 的独立性披露缺省值**：capability=context-only、
   independence=unverified（最低披露，不允许默认夸大）；observed-distinct
   必须 host-observed + session id（前置校验
   `TC_REVIEW_INDEPENDENCE_INVALID`）。
8. **review pass 的 evidence gate**：至少 1 条属于 review attempt 的
   evidence（缺则 `TC_REQUIRED_EVIDENCE_MISSING` 零写入）；`--evidence`
   支持单对象/数组/@path/@-。

## 四、验证命令（每次开发前后跑）

```bash
pnpm install --frozen-lockfile
pnpm check                       # test -> typecheck -> lint -> format:check -> build
git diff --check
node dist/cli.js --help
```

## 五、Task 04 应该怎么做

1. **先读**：本文件 → `development/plans/roadmap.md` →
   `development/plans/task-04-host-adapters.md` →
   `development/specs/architecture.md` §9（Adapter contract）→
   `development/specs/lifecycle.md` §7（连续执行合同与 Hook 协作）。
2. **创建 Trellis 任务**（复杂任务，需完整 prd/design/implement，可拆子任务树）：
   目标预期：Codex/Claude 两个 HostAdapter（capabilities/installEntry/
   testEntryHook/renderNodeBrief）、Node Brief 渲染、Entry Hook 安装与现场
   测试、`tc init --agent` / `tc agent` / `tc enable` 命令、run 观察
   （agent_runs）。复用现有 reducer/projector/query 与 `run` 输出路径。
3. **开发流程**：`trellis-implement` → `trellis-check` → `trellis-update-spec`
   → 提交（conventional commits）→ `/trellis:finish-work` 归档。
4. **提交前**：`pnpm check` 全绿 + `git diff --check` 干净。
5. **沟通语言**：中文。
6. **不要**：改 Task 00-03 已冻结的 storage.sql、schemas、既有 fixtures、
   specs；不要提前加 Watch/远程 CI；不要引入 ORM/bundler/workspace。
