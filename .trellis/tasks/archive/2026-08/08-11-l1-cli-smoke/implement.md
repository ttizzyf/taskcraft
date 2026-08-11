# Implement: L1 CLI vertical slice

## Checklist

1. `src/commands/init.ts`、`task-new.ts`、`task-show.ts`、`task-next.ts`、
   `task-cancel.ts`、`run.ts`（含 complete）、`status.ts`、`render.ts`。
2. `src/cli.ts` 注册子命令 + 全局 `--json`；根命令无参数时查唯一 active
   task 输出快捷 next（多个 active / 无 active 时打印帮助或状态）。
3. `tests/cli/init.test.ts`、`tests/cli/task.test.ts`、
   `tests/cli/run.test.ts`、`tests/cli/status.test.ts`（spawn dist/cli.js，
   临时目录 cwd）。
4. 真实 smoke：临时目录完整闭环
   `init -> task new -> run -> run complete` 到 done + cancel + 冲突路径。
5. 更新 `README.md` 的 Task 02 使用说明与命令示例。
6. `pnpm check` 全绿 + `git diff --check`。

## Validation

```bash
pnpm check
git diff --check
node dist/cli.js --help
node dist/cli.js --version
```

## Review Gates

- 只消费 core/ 接口，不重算状态；若发现 core 语义缺陷 → 回
  reducer-projector 修复或回 Plan，不在渲染层打补丁。
- 每个文件 ≤ 400 有效行。

## Commit

`feat(cli): deliver L1 vertical slice commands`（或按内容拆分
`feat(cli): ...` 与 `test(cli): ...`）→ `trellis-check` 审查 →
`/trellis:finish-work` 归档。

## After This Phase

父任务 Phase D 集成验收：核对父 prd.md Acceptance Criteria，更新
`task-02-handoff.md` 交接状态，顺手修正 `roadmap.md` Task 01 状态列，父任务
归档。
