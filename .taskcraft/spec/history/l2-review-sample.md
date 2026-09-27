# L2 Review CLI 样本（可回放）

> 三条 review 回流路径的真实命令序列 + 每步关键输出断言。样本基于
> `dist/cli.js` 在临时目录真实执行通过后固化（2026-08-12）。
> 回放方式：任意空目录执行 `node dist/cli.js init` 后逐条复制命令，
> 或按各路径的断言核对输出。所有 `--result` / `--evidence` 均可改用
> `@path` 文件或 `@-` stdin 传入。

## 路径 1：passed（L2 闭环到 done）

```bash
node dist/cli.js init
node dist/cli.js task new --title "Add retry policy" --level 2 --reason "Shared behavior needs separate review"
#   Task: T-1 / Revision: 1 / Status: queued / Next: tc run T-1 --node frame-1

node dist/cli.js run T-1 --node frame-1
#   Attempt: att-T-1-frame-1-1 / Next: tc run complete T-1 --node frame-1

node dist/cli.js run complete T-1 --node frame-1 \
  --result '{"objective":"Frame the retry policy","scope":{"modules":["core"]},"acceptance":["Retry policy is configurable per adapter"]}'
#   Revision: 3 / Next: tc run T-1 --node execute-1

node dist/cli.js run T-1 --node execute-1
#   Attempt: att-T-1-execute-1-1 / Next: tc run complete T-1

node dist/cli.js run complete T-1 \
  --result '{"summary":"Retry policy implemented","evidence":[{"type":"validation","reference":"ref://validation","summary":"Validated"},{"type":"test","reference":"ref://test","summary":"Tests pass"}]}'
#   Revision: 5 / Next: tc review start T-1 --node review-1 --purpose delivery --reviewed-attempt att-T-1-execute-1-1

node dist/cli.js review start T-1 --node review-1 --purpose delivery \
  --reviewed-attempt att-T-1-execute-1-1 --host claude
#   Revision: 6 / Review attempt: att-T-1-review-1-1 / Reviewed attempt: att-T-1-execute-1-1
#   Purpose: delivery / Capability: context-only / Independence: unverified
#   Next: tc review pass T-1 --attempt att-T-1-review-1-1 --reviewed-attempt att-T-1-execute-1-1

node dist/cli.js review pass T-1 --attempt att-T-1-review-1-1 \
  --reviewed-attempt att-T-1-execute-1-1 \
  --evidence '[{"type":"validation","reference":"ref://review-diff","summary":"Reviewer verified the diff and ran the boundary test"}]'
#   Revision: 7 / Outcome: passed / Next: tc run T-1 --node record-1

node dist/cli.js run T-1 --node record-1
#   Attempt: att-T-1-record-1-1 / Next: tc run complete T-1 --node record-1

node dist/cli.js run complete T-1 --node record-1 --result '{"summary":"Recorded"}'
#   Revision: 9 / Status: done

node dist/cli.js task show T-1
#   Status: done；Attempts 4 条（frame/execute/review/record 均 finished）；Evidence 5 条
```

## 路径 2：changes_requested（successor execute → 再 review → done）

```bash
# 前置：从 init 走到 review start（同路径 1，revision 1-6）
node dist/cli.js review changes T-1 --attempt att-T-1-review-1-1 --finding "Missing boundary test"
#   Revision: 7 / Outcome: changes_requested
#   Finding: fnd-T-1-1: Missing boundary test
#   Successor attempt: att-T-1-execute-1-2 / Next: tc run complete T-1

node dist/cli.js run complete T-1 \
  --result '{"summary":"Retry policy with boundary test","evidence":[{"type":"validation","reference":"ref://validation-2","summary":"Boundary test passes"},{"type":"test","reference":"ref://test-2","summary":"Tests pass"}]}'
#   Revision: 8 / Next: tc review start T-1 --node review-1 --purpose delivery --reviewed-attempt att-T-1-execute-1-2

node dist/cli.js review start T-1 --node review-1 --purpose delivery --reviewed-attempt att-T-1-execute-1-2
#   Revision: 9 / Review attempt: att-T-1-review-1-2

node dist/cli.js review pass T-1 --attempt att-T-1-review-1-2 \
  --reviewed-attempt att-T-1-execute-1-2 \
  --evidence '{"type":"validation","reference":"ref://review-2","summary":"Boundary test reviewed"}'
#   Revision: 10 / Outcome: passed / Next: tc run T-1 --node record-1

node dist/cli.js run T-1 --node record-1 > /dev/null
node dist/cli.js run complete T-1 --node record-1 --result '{"summary":"Recorded"}'
#   Revision: 12 / Status: done

node dist/cli.js task show T-1 --json
#   历史事实可查询：att-T-1-execute-1-1 仍为 finished/success（不改 outcome）；
#   att-T-1-execute-1-2 finished/success；att-T-1-review-1-1 finished/changes_requested；
#   findings 含 fnd-T-1-1（blocking, open, "Missing boundary test"）
```

## 路径 3：replan_required（新 revision → 重走 frame/execute → review → done）

```bash
# 前置：从 init 走到 review start（同路径 1，revision 1-6）
node dist/cli.js review replan T-1 --attempt att-T-1-review-1-1 \
  --reason scope_changed --finding "Contract changed"
#   Revision: 7 / Outcome: replan_required / Finding: fnd-T-1-1: Contract changed
#   New revision: 2 / Next: tc run T-1 --node frame-1

node dist/cli.js run T-1 --node frame-1
#   Attempt: att-T-1-frame-1-2（编号按节点全局递增，不复用旧 revision id）

node dist/cli.js run complete T-1 --node frame-1 \
  --result '{"objective":"Frame the revised contract","scope":{},"acceptance":["New acceptance"]}'
#   Revision: 9

node dist/cli.js run T-1 --node execute-1
#   Attempt: att-T-1-execute-1-2

node dist/cli.js run complete T-1 \
  --result '{"summary":"Revised implementation","evidence":[{"type":"validation","reference":"ref://validation-3","summary":"Validated"}]}'
#   Revision: 11 / Next: tc review start T-1 --node review-1 --purpose delivery --reviewed-attempt att-T-1-execute-1-2

node dist/cli.js review start T-1 --node review-1 --purpose delivery --reviewed-attempt att-T-1-execute-1-2
#   Revision: 12 / Review attempt: att-T-1-review-1-2

node dist/cli.js review pass T-1 --attempt att-T-1-review-1-2 \
  --reviewed-attempt att-T-1-execute-1-2 \
  --evidence '[{"type":"validation","reference":"ref://review-3","summary":"Revised contract reviewed"}]'
#   Revision: 13 / Outcome: passed

node dist/cli.js run T-1 --node record-1 > /dev/null
node dist/cli.js run complete T-1 --node record-1 --result '{"summary":"Recorded"}'
#   Revision: 15 / Status: done

node dist/cli.js task show T-1 --json
#   lifecycleRevision: 2；旧 revision 事实仍可见：att-T-1-frame-1-1 / execute-1-1
#   finished/success、att-T-1-review-1-1 superseded/superseded；
#   findings 含 fnd-T-1-1（blocking, "Contract changed"）
```

## 失败契约（三件套）

```bash
node dist/cli.js review pass T-1 --attempt att-T-1-review-1-1 \
  --reviewed-attempt att-T-1-execute-1-1 --evidence '[]'
#   退出码 1；stderr：TC_REQUIRED_EVIDENCE_MISSING + impact + remediation

node dist/cli.js review replan T-1 --attempt att-T-1-review-1-1 --reason bogus --finding x
#   退出码 1；stderr：TC_TASK_INPUT_INVALID（--reason 枚举校验）

node dist/cli.js review pass T-1 --attempt att-T-1-review-1-1 \
  --reviewed-attempt att-T-1-execute-1-1 --evidence '{"type":"validation","reference":"r","summary":"s"}' \
  --expected-revision 1
#   退出码 1；stderr：TC_REVISION_CONFLICT + tc status --json remediation
```
