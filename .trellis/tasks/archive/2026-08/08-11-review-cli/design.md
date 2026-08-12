# Design: L2 review CLI slice

## Command Wiring

`src/cli.ts` 注册 `tc review` 组（start/pass/changes/replan 四个子命令），
每个命令一个 `src/commands/review-*.ts`：

```text
tc review start T-202 --node review-1 --purpose delivery
    --reviewed-attempt att-execute-1 --host claude
    [--capability manual-attach] [--independence unverified]
tc review pass T-202 --attempt att-review-1 --reviewed-attempt att-execute-1
    --evidence @review.json        # @path / @- / 裸 JSON
tc review changes T-202 --attempt att-review-1 --finding "Missing boundary test"
tc review replan T-202 --attempt att-review-1 --reason scope_changed
    --finding "Contract changed"
```

- 命令解析沿用 src/commands/helpers.ts 的 `parseJsonInput` /
  `parseExpectedRevision` / `execute`（TaskcraftError→exit 1、内部→exit 2）。
- `--capability` / `--independence` 缺省：capability=context-only、
  independence=unverified（如实披露的最低披露，不允许默认夸大）。
- review pass 的 `--evidence` 必填（evidence gate），解析后传给 reducer 的
  evidence 段。
- `--expected-revision` 用 `optsWithGlobals()` 读取（Commander 同名选项坑，
  见 handoff）。

## Rendering

- review start 成功：command result 展示 review attempt id、reviewed
  attempt、purpose/capability/independence、next（review pass 命令）。
- review pass 成功：outcome + next（record-1 的 run 命令）。
- review changes/replan 成功：finding、successor attempt 或新 revision、
  next。
- 复用 render.ts 的 text 渲染；`--json` 输出 command-result/v1 结构。
- 全部只消费 reducer 返回数据与 project() 输出，无第二套推导。

## Sample（可回放）

`development/` 下记录 `l2-review-sample.md`：三条路径（passed /
changes_requested / replan_required）的完整命令序列 + 每步关键输出断言
（revision 号、attempt id、next）。样本在临时目录真实执行通过后固化。

## Tests

- tests/cli/review.test.ts：闭环（passed）、changes 回流（successor →
  再 review → done）、replan 回流（新 revision → 重走 → done）、退出码、
  --json 同源、--expected-revision 冲突。
- 每条路径断言历史事实可查询（task show 展示旧 attempt/finding/revision）。
