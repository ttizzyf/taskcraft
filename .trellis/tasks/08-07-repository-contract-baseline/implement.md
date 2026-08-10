# Implementation Plan: Repository Contract Baseline

- [x] 建立/更新 ADR 索引并接入 `development/README.md`。
- [x] 扫描并修复旧编号、旧路径、失效相对链接和错误权威描述。
- [x] 写入最小模块边界与 dependency direction，不创建生产目录。
- [x] 把 ADR 的技术选择、migration/Schema/test 要求整理为 Task 01 输入。
- [x] 生成父 PRD requirement/acceptance 到交付物和证据的最终映射。
- [x] 运行 Markdown 链接、JSON Schema、SQL、术语和 Git diff 检查。
- [x] 对父任务范围做一次交叉一致性审阅，阻塞发现返回 owning 子任务。
- [ ] 独立提交并归档本子任务。

## Validation

```bash
git diff --check
sqlite3 :memory: ".read development/contracts/storage.sql"
jq empty development/contracts/*.json development/contracts/fixtures/*.json
rg -n "task-0[0-9]|Task 0[0-9]|development/(product|lifecycle|architecture|cli)\.md" \
  README.md AGENTS.md development .trellis/spec
python3 ./.trellis/scripts/task.py validate \
  .trellis/tasks/08-07-repository-contract-baseline
```

Markdown link checker 和 JSON Schema compiler 使用 ADR 固定版本执行。检查失败
必须保留明确输出，不以忽略列表隐藏真实断链或 Schema 错误。

## Rollback

索引/交接提交可单独回退。若验证失败源于已冻结合同，停止本子任务并返回
`08-07-runtime-contract-freeze`，不在索引层添加例外说明绕过。
