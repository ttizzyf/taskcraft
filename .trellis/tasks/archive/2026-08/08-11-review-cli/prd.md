# L2 review CLI slice

## Goal

把 review 四命令接成可执行的 L2 CLI 纵切：`task new --level 2 ->
frame -> execute -> review -> record` 完整闭环到 done，changes_requested 与
replan_required 回流路径可走通，并交付可回放的 L2 实际样本。

## Requirements

### REQ-01. Review Command Surface

`tc review start <id> --node review-1 --purpose delivery --reviewed-attempt
<attempt-id> [--host <host>] [--capability <c>] [--independence <s>]
[--expected-revision <n>]`、`tc review pass <id> --attempt <id>
--reviewed-attempt <id> --evidence <path|json|@->`、`tc review changes <id>
--attempt <id> --finding <text>`、`tc review replan <id> --attempt <id>
--reason <code> --finding <text>`。全部支持 `--json`；失败非零退出 + 稳定
code/impact/remediation。

### REQ-02. L2 End-to-end Loop

`task new --level 2` 建卡后依次 frame run/complete、execute run/complete、
review start/pass、record run/complete 到 done；`task next` 的 review 节点
输出可直接执行的 review start/pass 命令。三条路径全部真实走通：
passed（到 done）、changes_requested（successor execute → 再 review →
done）、replan_required（新 revision → 重走 frame/execute → review → done）。

### REQ-03. Replayable L2 Sample

真实命令序列记录（development/ 文档或 fixture）：覆盖 passed /
changes_requested / replan_required 三条路径；回放后验证旧 attempt、finding、
successor、revision 均可查询（`task show` / query model）。

### REQ-04. CLI Integration Tests

spawn dist/cli.js：L2 闭环到 done、changes/replan 回流、退出码契约、
`--json` 输出与 text 同源、`--expected-revision` 冲突。

## Acceptance Criteria

- [ ] L2 三条路径（passed / changes_requested / replan_required）真实闭环到 done。
- [ ] review 命令失败非零退出，stderr 含稳定 code + impact + remediation。
- [ ] 可回放样本可执行，回放后历史事实（旧 attempt/finding/successor/revision）可查询。
- [ ] JSON 与 text 输出同源一致。
- [ ] 新增文件有效行 ≤ 400；`pnpm check` 全绿；`git diff --check` 干净。

## Non-goals

- 不实现 `task promote/revise`、L3 feasibility、Web UI。
- 不改 core 语义（渲染层只消费）；不新增 npm 依赖。

## Notes

- 依赖已归档的 review-reducer；命令语义以 cli.md §5 与父 design.md 为权威。
