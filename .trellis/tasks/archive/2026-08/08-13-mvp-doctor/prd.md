# tc doctor implementation

## Goal

实现 `tc doctor`（含 `--json`）：只读完整性检查，健康库退出 0，损坏库返回稳定
错误 + 非零退出且不修改数据库。

## Requirements

### REQ-01. 检查项（只读）

- migration ledger/checksum（复用 applyMigrations 的校验逻辑，只读模式）。
- SQLite 外键（`PRAGMA foreign_key_check`）。
- 孤儿引用：evidence/task_facts/blockers/review_links 指向不存在的
  task/attempt/node。
- 事件连续性：每 task 的 task_seq 从 1 连续、events 无 gap/重复。
- lifecycle definition digest：重算 facts/policy digest 与存储值一致。
- projector 重建：对每个 task 执行 project() 不抛错且输出形状完整。
- breadcrumb schema：构造结果过 `createContractValidators` 校验。

### REQ-02. 输出与退出码

健康 → exit 0 + 摘要；损坏 → 每项 `TC_STORE_*` 稳定错误（code/problem/
impact/remediation）+ 非零退出 + **零数据库写入**；`--json` 结构化输出。
未初始化 → TC_NOT_INITIALIZED（不建库）。

### REQ-03. Tests

健康库（migrations 后空库 + 完整 L1/L2/L3 数据）exit 0；每类损坏构造 →
对应稳定错误 + 非零退出 + 库哈希不变（零修改断言）；--json 形状。

## Acceptance Criteria

- [ ] `tc doctor` 健康库退出 0；`--json` 可解析。
- [ ] 每类支持损坏返回稳定错误 + 非零退出 + 不修改数据库（断言）。
- [ ] 未初始化不建库。
- [ ] 新增文件有效行 ≤ 400；`pnpm check` 全绿。

## Notes

- 依赖父 design 的 doctor.ts 纯函数拆分；只读（不 BEGIN 写事务）。
