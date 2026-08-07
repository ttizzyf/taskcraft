# Implementation Plan: Task 00 Contract Baseline

## Phase 0: Pre-Activation Gate

- [x] 独立审阅当前 Trellis 初始化与相关文档 diff，确认不含 Taskcraft 合同
  语义变更。
- [x] 将前置基线作为独立提交 `db393bb` 落地。
- [x] 复查 `git status --short`，区分用户既有工作与 Task 00 规划文件。
- [x] 分别对父任务和三个子任务运行
  `python3 ./.trellis/scripts/task.py validate <task-dir>`，检查规划工件。
- [x] 获得用户对本规划摘要、ADR 清单和探针清单的明确批准。

Phase 0 不属于 Task 00 实现提交。未通过时，父任务和三个子任务均保持
`planning`。

## Phase 1: Probe And Decision Child

- [ ] 启动 `08-07-contract-probes-decisions`，按其 `implement.md` 执行。
- [ ] 建立当前规范/合同矛盾矩阵和 ADR 决策映射。
- [ ] 仅执行获批准的 `CX-01..03`、`CL-01..03`、`DB-01`。
- [ ] 在 `development/decisions/` 写入 ADR，并更新能力研究证据。
- [ ] 向用户提交实际 ADR 结论与探针结果；若结论改变规划范围，回到 Phase 1
  重新收敛，而不是继续修改合同。
- [ ] 完成该子任务的检查、提交和归档。

Rollback point: 子任务 1 独立提交。失败探针不回滚证据，只把能力状态降为
`limited|pending|deferred` 并记录原因。

## Phase 2: Runtime Contract Freeze Child

- [ ] 仅在子任务 1 的 ADR 获批准后启动 `08-07-runtime-contract-freeze`。
- [ ] 按唯一规则源顺序修改 lifecycle、architecture、product、CLI，再同步
  SQL/JSON 可执行合同。
- [ ] 删除冲突旧语义，禁止新增平行状态、重复 validation 或隐藏 fallback。
- [ ] 为 SQL 能表达的不变量增加约束/trigger 探针；不能表达的语义明确归属
  reducer contract。
- [ ] 运行子任务合同验证、diff 审阅、提交和归档。

Rollback point: 子任务 2 独立提交。若合同测试暴露 ADR 缺陷，回退该提交并
回到子任务 1，不在 SQL 或 CLI 中加临时绕过。

## Phase 3: Repository Baseline Child

- [ ] 启动 `08-07-repository-contract-baseline`。
- [ ] 建立/修正文档索引、权威层级和 ADR 导航。
- [ ] 固化最小源码、测试、migration、合同资产边界，但不创建生产骨架。
- [ ] 将语言/工具链/模块/验证入口整理为 Task 01 的显式输入。
- [ ] 执行链接、Schema、SQL、术语和跨合同一致性检查。
- [ ] 完成子任务检查、提交和归档。

Rollback point: 子任务 3 独立提交；索引/交接问题只回退本子任务，不改写已
批准合同。

## Phase 4: Parent Integration Gate

- [ ] 三个子任务均已完成并归档后，启动父任务执行最终集成验收。
- [ ] 逐条核对 PRD R1-R10 与全部 Acceptance Criteria 的证据位置。
- [ ] 对 `task new`/`run`/activation、Review routing、revision-bound auth、
  capability taxonomy 做一次跨文档术语扫描。
- [ ] 确认没有生产实现、Hook 安装、动态 compiler 或 Task 01 工程骨架混入。
- [ ] 更新 `development/plans/roadmap.md` 的阶段结果时，只记录完成事实，不
  复制合同正文。
- [ ] 运行 Trellis check、提交父任务集成记录并归档。

## Validation Commands

具体依赖版本由 ADR 冻结；当前阶段的最小可重复命令为：

```bash
git diff --check
sqlite3 :memory: ".read development/contracts/storage.sql"
jq empty development/contracts/*.json development/contracts/fixtures/*.json
python3 ./.trellis/scripts/task.py validate .trellis/tasks/08-07-contract-baseline
rg -n "queued|active|reviewPurpose|feasibility|delivery|integration|R1|R2|R3" \
  AGENTS.md development/specs development/contracts development/decisions
```

JSON Schema Draft 2020-12 编译和 Markdown 链接检查使用 ADR 选定且固定版本的
工具补充；不以临时正则替代结构化验证。所有后台或宿主 smoke 使用硬超时，
不允许无限等待。

## Review Checklist

- [ ] 没有第二事实源、重复 reducer/permission/validation 逻辑。
- [ ] 没有 broad catch、吞错、伪成功或静默默认值。
- [ ] SQL 注释没有声称数据库保证其实际无法强制的不变量。
- [ ] ADR、spec、CLI、SQL/JSON 和 Task 01 输入没有未说明的行为差异。
- [ ] 未修改或回退用户既有的非 Task 00 工作。
