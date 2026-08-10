# Implementation Plan: Runtime Contract Freeze

- [x] 锁定已批准 ADR commit，生成 ADR-to-contract 修改矩阵。
- [x] 更新 lifecycle 的 activation、三种 Review outcome、Agent 派发与中断规则。
- [x] 更新 architecture 的事实边界、enforcement owner 和 Adapter capability。
- [x] 仅同步 product 中用户可见旅程和状态行为。
- [x] 更新 CLI command transition、JSON result、error/remediation 示例。
- [x] 更新 SQL/JSON，删除 host 枚举、`passed_with_fix`、R1/R2/R3 和
  `review_resolutions`，且不新增 auth/probe/capability 实体。
- [x] 同步 `AGENTS.md`、roadmap 和 Task 03/04/05 的后续实施范围。
- [x] 为 activation、Review 引用、跨 revision evidence 和事件序列执行正反例
  内存 SQLite probe。
- [x] 编译 JSON Schema 并验证全部 fixtures。
- [x] 运行术语/枚举矩阵、链接、diff 和 Trellis check。
- [x] 独立提交并归档本子任务。

## Validation

```bash
git diff --check
sqlite3 :memory: ".read development/contracts/storage.sql"
jq empty development/contracts/*.json development/contracts/fixtures/*.json
rg -n "queued|active|reviewPurpose|feasibility|delivery|integration|passed_with_fix|changes_requested|replan_required" \
  development/specs development/contracts
python3 ./.trellis/scripts/task.py validate \
  .trellis/tasks/08-07-runtime-contract-freeze
```

JSON Schema 编译与 SQL 正反例使用 ADR 固定版本的工具/脚本；backend test 若
引入测试 runner，单次硬超时为 60 秒。

## Rollback

本子任务是一个独立合同提交。任一不变量无法一致表达时回退整个提交并修改
ADR，不保留半套新合同或临时兼容分支。
