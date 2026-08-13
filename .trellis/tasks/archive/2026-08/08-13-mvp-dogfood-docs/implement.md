# Implement: dogfood & doc sync

## Checklist

1. `tc state`（breadcrumb/json）+ `tc task list` 命令 + cli.ts 注册；
   hooks/entry.sh 模板改为调用 `tc state --breadcrumb`。
2. cli.md 收敛标注（deferred 列表 + 新增命令）；`tc --help` 与规范一致。
3. 真实宿主 dogfood（逐次授权）：L1、waiting/resume、L2、跨会话恢复；
   写 `development/dogfood-2026-08-13.md`。
4. 文档同步：host-smoke 标注修正、README/roadmap/handoff 用词。
5. 迁移门复核表（runbook §1 逐条）→ pass/blocked 结论落库。
6. `pnpm check` + `git diff --check` + `pnpm smoke:watch` 全绿。

## Validation

```bash
pnpm check
git diff --check
pnpm smoke:watch
node dist/cli.js state --breadcrumb
```

## Commit

`feat(cli): add state and task list; converge CLI surface` +
`docs: sync status and dogfood records`（或按内容拆）→ `trellis-check` →
`/trellis:finish-work` 归档。

## After This Phase

父任务迁移门复核收口：核对父 prd AC、更新 handoff、roadmap 追加 Task 07
状态、父任务归档。
