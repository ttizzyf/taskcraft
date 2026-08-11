# Implement: Taskcraft store kernel and L1 vertical slice

## Execution Order

依赖顺序：`store-transaction` → `reducer-projector` → `l1-cli-smoke` → 父任务
集成验收。每个子任务独立 start / check / commit / 归档；父任务只在最后一个
子任务完成后做最终纵切验收，不在过程中 start。

## Ordered Checklist

### Phase A: store-transaction 子任务

1. `task.py start` 08-11-store-transaction（规划产物完成后）。
2. 实现 `src/store/transaction.ts`：`withTransaction(db, fn)` 封装
   `BEGIN IMMEDIATE` / COMMIT / ROLLBACK，异常时回滚并包裹为
   `TC_STORE_TRANSACTION_FAILED`（保留 cause）。
3. 实现 `src/store/revision-guard.ts`：`checkRevision(db, taskId,
   expectedRevision)`，不匹配抛 `TC_REVISION_CONFLICT`；返回当前快照供
   reducer 使用。
4. 实现 `src/store/query.ts`：只读查询（task 行、attempts、evidence、
   obligations、blockers、events 最近 seq），供 projector/CLI 消费；
   不暴露写接口。
5. 测试：事务回滚无部分事实（构造中途失败）、嵌套/缺事务保护、CAS 冲突
   返回稳定错误与当前 revision、query 只读（写尝试被类型拒绝）。
6. `pnpm check` 全绿 → 提交（`feat(store): ...`）→ `trellis-check` 审查 →
   `/trellis:finish-work` 归档。

### Phase B: reducer-projector 子任务

1. `task.py start` 08-11-reducer-projector（依赖 Phase A 已归档）。
2. 实现 `src/core/lifecycle/l1.ts`：L1 静态图（nodes/edges/obligations/
   result schemas/evaluator 常量），与 design.md 的 L1 内置图一致。
3. 实现 `src/core/errors.ts` + `src/core/command-result.ts`。
4. 实现 `src/core/reducer.ts`：taskNew / run / runComplete / cancel 四个
   命令的事务逻辑（引用校验、schema 校验、CAS、事实 + 审计 event 原子写、
   record 自动闭合、required obligation 满足规则）。
5. 实现 `src/core/projector.ts`：五状态推导（优先级 cancelled > done >
   waiting > active > queued）、runnable/running、waitingReason、唯一 next；
   `src/core/breadcrumb.ts` 构造 breadcrumb。
6. 交付 fixtures（`development/contracts/fixtures/`，只增不改既有文件）：
   l1-pass、validation-missing、five-status、revision-conflict、
   transaction-rollback、cancel、retry-exhaustion。
7. 测试：reducer 原子写与回滚、obligation/evidence 规则（含
   "验证缺失不能 done"）、projector 五状态 + waiting + next、retry
   exhaustion fixture、observation 不驱动完成。
8. `pnpm check` 全绿 → 提交 → `trellis-check` → 归档。

### Phase C: l1-cli-smoke 子任务

1. `task.py start` 08-11-l1-cli-smoke（依赖 Phase B 已归档）。
2. 扩展 `src/commands/`：init / task-new / run / run-complete / task-cancel /
   status / task-show / task-next；根命令 `tc` 一个 active task 时快捷 next。
3. 实现 text 与 JSON 渲染（共用 projector 输出）、Node Brief（纯数据版）、
   错误到 stderr + 非零退出。
4. `src/cli.ts` 注册子命令；`--json` 全局支持；`run complete --result`
   支持 `<path|json|stdin>`。
5. 测试：CLI 集成（spawn dist/cli.js）——init 幂等、task new 拒绝
   level 2/3、完整 L1 闭环到 done、cancel、CAS 冲突、JSON/text 一致、
   退出码契约；真实临时目录 smoke。
6. `pnpm check` 全绿 → 提交 → `trellis-check` → 归档。

### Phase D: 父任务集成验收

1. 临时目录端到端 smoke：`init -> task new -> run -> run complete` 到
   `done`；`task cancel`；`--expected-revision` 冲突路径。
2. 验收清单逐条核对父任务 prd.md 的 Acceptance Criteria（含
   `git diff --check`、`pnpm check`）。
3. 检查 plans/ 与 contracts/ 无改动；`task-02-handoff.md` 更新为 Task 02
   交接状态；`roadmap.md` 的 Task 01 状态顺手修正（记录在提交说明）。
4. 父任务 `task.py finish` 后归档（`/trellis:finish-work`）。

## Validation Commands

```bash
pnpm install --frozen-lockfile   # 可复现安装（加依赖时才 pnpm install）
pnpm check                       # test -> typecheck -> lint -> format:check -> build
git diff --check                 # 空白错误检查
node dist/cli.js --help
```

## Review Gates

- 每个子任务提交前：`pnpm check` 全绿 + `git diff --check` 干净 +
  `trellis-check` 子代理审查通过。
- 冻结文件（contracts/、migrations/0001_initial.sql、specs/）出现 diff 时
  停止并回 Plan 讨论，不直接改。
- 超过 400 有效行的新文件必须拆分子模块，不豁免。

## Rollback Points

- Phase A 事务封装失败：不影响业务代码，直接修复。
- Phase B 语义与冻结合同冲突：回 Plan 修正 design.md，不改 contract。
- Phase C CLI 行为问题：只改 commands/ 与渲染，不动 core/。
- 任一阶段不可修复时：回退最后一个稳定提交，报告后继续。
