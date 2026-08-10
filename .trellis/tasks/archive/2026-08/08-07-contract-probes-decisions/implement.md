# Implementation Plan: Probe And Decision Pack

- [ ] 确认父任务 Entry Gate 和用户批准记录。
- [ ] 建立需求 R1-R8 到 ADR、证据和合同消费者的矩阵。
- [ ] 记录 Codex/Claude/SQLite 当前版本和当前研究证据，不覆盖历史样本。
- [ ] 按批准清单依次运行 `CX-01..03`、`CL-01..03`、`DB-01`；每项设置硬
  超时并单独保存结果摘要。
- [ ] 对失败或缺失能力给出 `limited|pending|deferred`，不得添加模拟成功。
- [ ] 写入 8 项 ADR；运行一次 ADR 互斥性和合同映射审阅。
- [ ] 更新宿主可行性报告的版本、状态和证据边界。
- [ ] 向用户提交 ADR 结论和实际探针结果；未获批准不得完成本子任务。
- [ ] 运行 Markdown 链接检查、`git diff --check` 和 Trellis check。
- [ ] 独立提交并归档本子任务。

## Validation

```bash
git diff --check
rg -n "verified|documented|limited|pending|deferred" \
  development/decisions development/research/host-feasibility.md
python3 ./.trellis/scripts/task.py validate \
  .trellis/tasks/08-07-contract-probes-decisions
```

## Rollback

ADR/研究更新使用独立提交回退。失败探针的原始结论不删除；若决定不采用该
能力，ADR 标记限制或 deferred，并保留证据。
