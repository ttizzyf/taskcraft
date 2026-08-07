# Implementation Plan: Runtime Contract Freeze

- [ ] 锁定已批准 ADR commit，生成 ADR-to-contract 修改矩阵。
- [ ] 更新 lifecycle 的 activation、Review routing、revision/input/auth 规则。
- [ ] 更新 architecture 的事实边界、enforcement owner 和 Adapter capability。
- [ ] 仅同步 product 中用户可见旅程和状态行为。
- [ ] 更新 CLI command transition、JSON result、error/remediation 示例。
- [ ] 更新 SQL/JSON 的可执行约束与注释，删除不再成立的旧约束。
- [ ] 为 activation、Review purpose、跨 revision evidence/auth 和事件序列执行
  正反例内存 SQLite probe。
- [ ] 编译 JSON Schema 并验证全部 fixtures。
- [ ] 运行术语/枚举矩阵、链接、diff 和 Trellis check。
- [ ] 独立提交并归档本子任务。

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
