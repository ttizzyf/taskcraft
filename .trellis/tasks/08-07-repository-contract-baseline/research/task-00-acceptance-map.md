# Task 00 验收映射

本文件只记录 Task 00 的验收位置和检查证据，不是新的产品规范。发生冲突时，
以根 `AGENTS.md`、`development/specs/` 和 `development/contracts/` 为准。

## 需求映射

| 父任务需求 | 决策与权威合同 | 验证证据 |
| --- | --- | --- |
| REQ-01 激活与 attempt | ADR 0001；`lifecycle.md` 第 8 节；`cli.md` 第 4、5、7.1 节；`storage.sql` 的 tasks/node_attempts | 运行时合同矩阵；SQL 空库加载 |
| REQ-02 Review 路由 | ADR 0002；`lifecycle.md` 第 8、9 节；`cli.md` 第 5、7.1 节；review_links/findings | 三种 outcome 术语扫描；SQL purpose/kind trigger |
| REQ-03 输入、secret 与高风险决定 | ADR 0003；`architecture.md` 第 3.2、10 节；task_facts/blockers/events | 无 Credential/Authorization 生产实体；secret 边界扫描 |
| REQ-04 宿主能力 | ADR 0004；`architecture.md` 第 2、9 节；agent_runs | `host-feasibility.md` 的 CX/CL 探针和状态；提交 `a3780ca` |
| REQ-05 工程选择 | ADR 0005、0006；`architecture.md` 第 7 节 | Task 01 固定版本、migration 和命令输入 |
| REQ-06 结果校验与 Agent 工具 | ADR 0007；`lifecycle.md` 第 9.1 节；`architecture.md` 第 2、10 节 | Ajv strict 编译；仓库无通用 probe runner |
| REQ-07 文档权威 | ADR 0008；`development/README.md`；`.trellis/spec/taskcraft.md` | ADR 导航；150 个 Markdown 文件链接检查 |
| REQ-08 初始模块边界 | ADR 0008；Task 01 的“最小文件与依赖方向” | 工作区无生产 `src/`、`tests/`、`migrations/` |
| REQ-09 合同修改门 | 父任务与两个已归档子任务的 PRD/design/implement | 用户先批准 ADR/探针，再由提交 `cc0efcf` 冻结合同 |
| REQ-10 基线分离 | Git 提交 `ba20823`、`276565a`、`db393bb`、`a3780ca`、`cc0efcf` | 项目、Trellis、探针/ADR、运行时合同可分别审阅 |

## 父任务验收标准

| 验收项 | 结果 | 位置或证据 |
| --- | --- | --- |
| 建卡、激活和首个 attempt 只有一种解释 | 通过 | ADR 0001、lifecycle 8、CLI transition table |
| 三种 Review outcome 都有确定 next | 通过 | ADR 0002、lifecycle 9、CLI transition table |
| 不建立凭据/授权系统，secret 不落库 | 通过 | ADR 0003、architecture 3.2/10、storage.sql |
| 工具链选择完整且可交给 Task 01 | 通过 | ADR 0005/0006、Task 01 固定技术选择 |
| 宿主声明区分文档、实测、限制和延期 | 通过 | ADR 0004、host-feasibility.md |
| 本地校验与 Agent 工具边界明确 | 通过 | ADR 0007、architecture 2/10、lifecycle 9.1 |
| 文档无旧路径和断链 | 通过 | 开发入口、ADR 索引、Markdown 检查 |
| SQL/JSON 可解析且合同一致 | 通过 | SQLite、jq、Ajv 检查；运行时合同矩阵 |
| Task 01 无需重做 Task 00 技术决策 | 通过 | Task 01 必读输入、固定技术选择、最小文件与依赖方向 |
| 初始基线、Trellis 与合同提交可分开审阅 | 通过 | `ba20823`、`276565a`、`db393bb`、`a3780ca`、`cc0efcf` |
| Trellis 前置基线独立完成 | 通过 | `db393bb` |
| 没有生产业务实现 | 通过 | 本子任务只修改文档和 Trellis 验收工件 |

## 本子任务验证记录

- SQLite 3.50.6：`storage.sql` 成功加载到内存数据库，共 16 张表；
  `PRAGMA foreign_key_check` 无结果。
- Ajv 8.17.1：Draft 2020-12 strict 下成功编译 Lifecycle 和 Breadcrumb Schema；
  两个代表性实例通过验证。
- `jq empty`：两份 Schema 和 `l2-task.fixture.json` 均可解析。
- Markdown：检查 150 个已跟踪或新增的 Markdown 文件，相对链接和标题锚点
  全部可解析；代码块中的示例链接不参与检查。
- 旧术语：活动规范中没有旧 Review 路由、旧任务路径或“Task 00 尚未启动”；
  `host-feasibility.md` 只保留一条明确标为旧版探针结果的历史记录。
- `git diff --check`：通过。

前两个子任务的交付提交分别为 `a3780ca` 和 `cc0efcf`，归档提交分别为
`c5f37e5` 和 `7012e7b`。本子任务提交与归档完成后，父任务只需复核本表和
最终 Git 状态，不再重新设计产品合同。
