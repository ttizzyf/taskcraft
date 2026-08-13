# Design: tc doctor

## 结构

```ts
// src/core/doctor.ts（纯函数，只读）
export interface DoctorCheck { name: string; ok: boolean; problem?: string; }
export function runDoctorChecks(db: TaskcraftDatabase): DoctorCheck[];
// 内部：checkMigrationLedger / checkForeignKeys / checkOrphans /
//       checkEventContinuity / checkDefinitionDigest / checkProjectionRebuild /
//       checkBreadcrumbSchema

// src/commands/doctor.ts
// tc doctor [--json]：打开库（只读）→ runDoctorChecks → 汇总
//   全 ok → exit 0；有损 → 输出 TC_STORE_INTEGRITY_FAILED 等三件套 + exit 1
```

## 检查实现要点

- ledger：读 schema_migrations 与磁盘 migration 文件比对（复用
  migrations.ts 的校验函数——重构导出 `validateAppliedHistory` 供只读调用）。
- 外键：`PRAGMA foreign_key_check` 全表。
- 孤儿：SELECT 不存在父引用的行（evidence/task_facts/blockers/review_links
  按 storage.sql 外键语义）。
- 事件连续性：per-task `MAX(task_seq)` vs COUNT，gap 检测。
- digest：重算（facts 为空时 SHA-256("")）比对 lifecycle_revisions 行。
- 重建：每 task project() 成功 + breadcrumb 过 validator（复用
  createContractValidators）。

## 测试

tests/core/doctor.test.ts + tests/cli/doctor.test.ts：健康库、逐类损坏
（删 event 行、断外键、篡改 digest、断孤儿）、--json、零修改断言
（PRAGMA data_version 或文件哈希前后一致）。
