# Design: Store and transaction layer

## Interfaces

```ts
// transaction.ts
export function withTransaction<T>(
  db: TaskcraftDatabase,
  fn: () => T,
): T;   // BEGIN IMMEDIATE -> fn -> COMMIT；fn 抛错 -> ROLLBACK 并包
        // TC_STORE_TRANSACTION_FAILED（保留 cause，message 含任务上下文）

// revision-guard.ts
export interface TaskSnapshot {
  id: string;
  title: string;
  level: 1 | 2 | 3;
  revision: number;
  currentLifecycleRevision: number;
  activatedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  // + task 内容字段（objective_md、scope_json、acceptance_json、classification_*）
}
export function checkRevision(
  db: TaskcraftDatabase,
  taskId: string,
  expectedRevision: number,
): TaskSnapshot;   // 不匹配 -> TC_REVISION_CONFLICT（带当前 revision 与重读命令）
                   // 不存在 -> TC_TASK_NOT_FOUND

// query.ts — 全部只读，返回纯数据（string/number/boolean/null，无 Row 包装）
export function getTask(db, taskId): TaskSnapshot | null;
export function getLifecycle(db, taskId, revision): { nodes: NodeRow[]; edges: EdgeRow[]; obligations: ObligationRow[] };
export function getAttempts(db, taskId): AttemptRow[];
export function getEvidence(db, taskId): EvidenceRow[];
export function getObligationResults(db, taskId): ObligationResultRow[];
export function getOpenBlockers(db, taskId): BlockerRow[];
export function getLastEventSeq(db, taskId): number;
```

## Decisions

- `withTransaction` 不在函数内自动开启嵌套事务；better-sqlite3 的
  `inTransaction` 为 true 时直接抛 `TC_STORE_TRANSACTION_FAILED`，不静默复用
  外层事务（事务边界必须显式）。
- CAS 读取与写在同一事务内完成（`withTransaction` 内先 `checkRevision`
  再写），避免 TOCTOU；事务由调用方（reducer）组合。
- query model 全部使用 `prepare(...).get/all`，禁止裸 `exec` 返回数据；
  类型只读（返回类型无写方法）。
- 错误类型放 `src/core/errors.ts`（与 reducer 共享），store 层只抛
  `TC_STORE_*` 与 `TC_REVISION_*`、`TC_TASK_NOT_FOUND`（code 常量从 core 导入
  避免字符串漂移；若 core 未就绪则先建最小 errors.ts，reducer-projector 扩充）。
  实际按依赖方向调整：errors.ts 属 core，store-transaction 先建
  `src/core/errors.ts` 骨架（本子任务只填本层用到的 code）。

## Tests

- 回滚：`withTransaction` 内写一行后抛错 → 事务前后 `SELECT count(*)` 相等。
- 提交：fn 成功 → 行存在；COMMIT 后查询可见。
- CAS：正确 revision 通过并返回快照；错误 revision 抛 `TC_REVISION_CONFLICT`
  且错误对象含当前 revision 与 remediation 命令；task 不存在抛
  `TC_TASK_NOT_FOUND`。
- query：对空库与迁移后库返回预期形状；类型测试断言无写方法（编译期）。
- 与 `applyMigrations` 组合 smoke：临时文件 DB 走
  `openDatabase -> applyMigrations -> withTransaction`。
