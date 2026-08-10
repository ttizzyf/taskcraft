# ADR 到正式合同的修改矩阵

批准的 ADR 与宿主探针输入锁定在 commit `a3780ca`。

| 决定 | 正式规则位置 | 可执行约束或后续任务 |
| --- | --- | --- |
| 建卡与激活分开 | `lifecycle.md` 第 8 节、`cli.md` 第 4/5/7 节 | `storage.sql` 保留 nullable `activated_at`；首次 `run` 由 reducer 原子写激活和 attempt |
| Review 只保留三种 outcome | `lifecycle.md` 第 9 节、`cli.md` 第 5/7 节 | SQL/Schema 删除 `passed_with_fix` 和 `review_resolutions`；Task 03 只实现三条路径 |
| 独立 reviewer 是优先项而非硬门 | `lifecycle.md` 第 9 节、`architecture.md` 第 6 节 | 保留 capability/independence 披露；删除 actor constraint |
| 用户输入和高风险决定复用现有事实 | `lifecycle.md` 第 9 节、`architecture.md` 第 3/10 节 | 复用 fact/blocker/event；不增加 Input、Credential、Authorization 表 |
| host id 开放，首版只实现两个 Adapter | `architecture.md` 第 9 节、`cli.md` 第 3 节 | SQL 删除 host CHECK；Task 04 实现 Codex/Claude，其他 host 明确 unsupported |
| Taskcraft 不派发 subagent | `lifecycle.md` 第 7/10 节、`architecture.md` 第 2 节 | Node Brief 只给派发说明；Agent 决定派发或自行执行 |
| 用户中断始终有效 | `lifecycle.md` 第 7 节、`product.md` 第 4.6 节 | Stop Hook 只拦正常结束；下次会话按 Task Store 的 next 恢复 |
| 结果在本地校验 | `lifecycle.md` 第 7 节、`cli.md` 第 8 节 | Taskcraft 写入前用 Ajv 校验；模型原生 JSON Schema 只是可选辅助 |
| 不实现通用 probe runner | `lifecycle.md` 第 9 节、`architecture.md` 第 2/10 节 | Agent 使用宿主工具并提交 evidence；Task 05 不新增 runner 或权限系统 |

ADR 解释选择原因；运行时行为仍以 `development/specs/` 和
`development/contracts/` 为准。
