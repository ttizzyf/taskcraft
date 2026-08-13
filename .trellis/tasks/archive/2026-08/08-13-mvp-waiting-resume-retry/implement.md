# Implement: waiting/resume/retry

## Checklist

1. reducer：blocker.ts（taskWait/taskResume）+ failure/retry 公开化
   （runFail/runRetry 或扩展现有 failure.ts）。
2. commands：task-wait.ts、task-resume.ts、run-fail.ts、run-retry.ts +
   cli.ts 注册。
3. tests：reducer.blocker.test.ts、reducer.retry.test.ts、
   tests/cli/waiting.test.ts（双进程闭环）。
4. `pnpm check` 全绿 + `git diff --check`。

## Validation

```bash
pnpm check
git diff --check
# 双进程 smoke：wait 后新进程 status 显示 waiting，resume 后继续
```

## Commit

`feat(cli): add waiting, resume and retry loop`（或按内容拆 feat/test）→
`trellis-check` → `/trellis:finish-work` 归档。
