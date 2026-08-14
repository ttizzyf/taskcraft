# Task 02 交接说明（L1 纵切已完成）

> 更新日期：2026-08-11。本文件是给新会话 agent 的交接文档：Task 02（Store 内核与
> L1 纵切）已完成并归档，新 agent 应先读本文件了解现状与约束，再开始 Task 03
> （L2 Review 环）。

## 一、当前状态

- **仓库**：Taskcraft，`main` 分支。
- **Task 01（工程基础）与 Task 02（L1 纵切）已完成、已提交、已归档**
  （`.trellis/tasks/archive/2026-08/`）。
- **无活动 Trellis 任务**。Task 03 尚未创建。
- **上游产物**：`development/contracts/`（storage.sql、schemas、fixtures）与
  `development/specs/`（产品/生命周期/架构/CLI 规范）仍冻结；Task 02 只在
  `contracts/fixtures/` 新增了 7 个 L1 运行时 fixture，未改动任何既有文件。

## 二、Task 02 已完成的内容

```text
src/store/transaction.ts            # withTransaction：BEGIN IMMEDIATE/COMMIT/ROLLBACK；
                                    #   TaskcraftError 穿透，其余包 TC_STORE_TRANSACTION_FAILED
src/store/revision-guard.ts         # checkRevision：CAS 守卫 + TaskSnapshot
src/store/query.ts                  # 只读 query model（含 listTasks；getLastEventSeq 按 task_id）
src/core/errors.ts                  # TaskcraftError（code/problem/impact/remediation）+ ERROR_CODES
src/core/lifecycle/l1.ts            # L1 内置图：execute-1 -> record-1、3 条 required
                                    #   obligations、result schemas、evaluator、digest 常量
src/core/reducer.ts + reducer/      # 单 reducer：taskNew/run/runComplete/cancel + 失败语义
                                    #   （3 次失败写 failed_retries_exhausted blocker）
src/core/projector.ts               # 单 projector：五状态 + runnable/running + waitingReason
                                    #   + 唯一 next + breadcrumb；不读 agent_runs
src/core/command-result.ts          # tc-command-result/v1 构造器
src/core/breadcrumb.ts              # tc-breadcrumb/v1 构造器（过 breadcrumb.schema.json）
src/commands/                       # init / task new/show/next/cancel / run / run complete /
                                    #   status + helpers + render（text/JSON 同源）
migrations/0001_initial.sql         # 未改动（L1 图是运行时数据，不是 migration）
development/contracts/fixtures/     # +l1-pass / validation-missing / five-status /
                                    #   revision-conflict / transaction-rollback / cancel /
                                    #   retry-exhaustion（共 7 个，既有 l2-task 未动）
tests/                              # 99 用例：store/core/commands/contracts/tooling
```

**可复用入口（Task 03 直接 import）**：

- `withTransaction(db, fn)` — 事务封装，业务错误（TaskcraftError）穿透不包装。
- `checkRevision(db, taskId, expectedRevision)` — CAS 守卫，返回快照。
- `project(db, taskId)` — 五状态 + runnable + waitingReason + 唯一 next +
  breadcrumb 的唯一投影入口。
- `taskNew/run/runComplete/cancel`（`src/core/reducer.ts`）— 事实写命令。
- `L1_*` 常量（`src/core/lifecycle/l1.ts`）— L1 图、schema、obligation 定义。
- `createContractValidators()` / `loadL2TaskFixture()`（Task 01 产物，未动）。

## 三、关键工程决策（新 agent 必须遵守，勿回退）

1. **record obligation 必须物化 record-1 attempt**：storage.sql 的
   `obligation_results_evidence_owner_insert` trigger 要求 satisfied 的 evidence
   必须属于**同 node、同 revision** 的 attempt。execute 的 evidence 永远不能
   满足 record-1 obligation（会 ABORT）。`run complete` 的 result 含 `record`
   段时，reducer 在同一事务物化 finished/success 的 record-1 attempt + 归其
   所有的 note evidence 再满足 record obligation。
2. **record 补交闭环**：execute 完成但 result 无 record 段 → record obligation
   pending、record-1 runnable、next = `tc run <id> --node record-1` →
   `tc run complete <id> --node record-1`。`run()` 支持 claim 任意 runnable
   节点（blocked/satisfied/不存在的节点拒绝 `TC_ATTEMPT_REF_INVALID`）；
   `run complete` 按节点分支（`--node` execute-1 或 record-1）。
3. **`run complete` 是 execute 的闭合**：execute-1 的 Node Brief 内联 result
   schema（含 `record` 段 $ref），Agent 一次提交可到 done；首次 `run` 的激活
   事实不可省略。
4. **`--facts` 已持久化**：`task new --facts` 的对象经校验后写入
   `tasks.classification_facts_json`（缺失 = `{}`，非对象拒绝
   `TC_TASK_INPUT_INVALID`）。
5. **Commander 父子命令同名选项坑**：`--node`/`--expected-revision` 同时声明
   在父 `run` 与子 `complete` 时，Commander 15 由父命令先消费，子命令必须用
   `optsWithGlobals()` 读取。后续加同名选项沿用此模式。
6. **`getLastEventSeq` 必须按 task_id 过滤 `MAX(task_seq)`**：用全局
   `MAX(seq)`（AUTOINCREMENT）在多任务下必然触发
   `events_task_sequence_insert` 冲突（per-task 连续性）。
7. **任务 ID 生成**：`T-<N>`（事务内 `COUNT(*)+1`，单进程 better-sqlite3
   串行写安全）。
8. **失败 attempt 语义（Task 02 历史状态）**：Task 02 归档时只有 reducer 能力，
   尚无公开 CLI；Task 07 已补齐 `run fail/retry`、`task wait/resume`，连续 3 次
   失败写 open blocker `failed_retries_exhausted` → projector 输出 `waiting`。
9. **其余沿用 Task 01 约束**：max-lines 400（不豁免）、npmmirror 版本冻结、
   测试隔离、pretest 先 build、ajv 具名导入、无 ORM/bundler/workspace。

## 四、验证命令（每次开发前后跑）

```bash
pnpm install --frozen-lockfile   # 可复现安装
pnpm check                       # test -> typecheck -> lint -> format:check -> build
git diff --check
node dist/cli.js --help          # CLI smoke
```

## 五、Task 03 应该怎么做

1. **先读**：本文件 → `development/plans/roadmap.md`（状态已更新）→
   `development/plans/task-03-l2-review-loop.md` → `development/specs/cli.md`
   §5（review 命令面）→ `development/specs/lifecycle.md` §9（Review 回流）。
2. **创建 Trellis 任务**（复杂任务，需完整 prd/design/implement，可拆子任务树）：
   目标预期：L2 图（frame/execute/review/record）、`review start/pass/changes/
   replan` 命令、revision 切换（旧 revision 的 created/running attempt →
   superseded）、review_links/findings 回流。复用
   `withTransaction/checkRevision/project/reducer` 入口。
3. **开发流程**：`trellis-implement`（子代理）→ `trellis-check`（子代理审查）
   → `trellis-update-spec`（如语义变化）→ 提交（conventional commits：
   `feat:` / `fix:` / `test:` / `docs:` / `chore(task):`）→
   `/trellis:finish-work` 归档。
4. **提交前**：必须 `pnpm check` 全绿 + `git diff --check` 干净。
5. **沟通语言**：中文。
6. **不要**：改 Task 00-02 已冻结的 storage.sql、schemas、既有 fixtures、
   specs；不要提前加 Watch/Adapter/Hook/远程 CI；不要引入 ORM/bundler/workspace。
   L2/L3 在同一 reducer/projector 上增量扩展，不预建平行状态机。
