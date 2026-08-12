# Design: L3 CLI loop and sample

## Command Wiring

```text
tc task fact add T-301 --attempt <id> --category probe --subject "API" \
    --value @api.json [--evidence <id>] [--supersedes <id>]
tc task new --level 3 ...（已支持）
```

- `src/commands/task-fact-add.ts`：category 枚举预校验（intent|probe|
  constraint|assumption|dependency|environment）、--value 复用
  parseJsonInput（@path/@-/裸 JSON）、错误三件套。
- L3 闭环命令序列（cli.md §4 L3 示例）：frame → plan → feasibility
  review start/pass → execute → delivery review start/pass → integrate →
  （modifiedDeliverables 时）integration review start/pass → record → done。
- feasibility changes 回流：review changes --purpose 对应 review attempt →
  plan successor → 重新 feasibility review。
- review start 的 --reviewed-attempt 缺省按 purpose 解析（reducer 已实现）。

## Sample（可回放）

`development/l3-sample.md`：主路径（feasibility passed 到 done）+ 一条
回流路径；每步断言 revision 号、attempt id、next 命令、fact 查询结果。
临时目录真实执行验证后固化。

## Tests

- tests/cli/l3.test.ts：主闭环到 done；`run --node execute-1` 在 feasibility
  未过时被拒（TC_ATTEMPT_REF_INVALID 或 next 不指向 execute）；feasibility
  changes 回流；fact add 持久化可查（task show 展示 facts）；退出码；
  --json 同源。
- 深链验证不做（属 Watch）。
