# Design: Runtime Contract Freeze

## Update Order

先更新唯一语义规则源，再更新消费者：

1. `lifecycle.md`：activation、node/review/outcome/revision 语义。
2. `architecture.md`：事实归属、reducer/projector/Adapter 和安全边界。
3. `product.md`：只同步用户旅程与可见行为。
4. `cli.md`：把语义映射为 command transition、JSON 和稳定错误。
5. `storage.sql` 与 JSON Schema：实现可由存储层强制的结构约束。
6. `AGENTS.md` 与相关 plans：删除仍会让后续任务实现旧设计的入口规则。

这种顺序避免 CLI 或 SQL 反向定义产品语义。跨文件相同段落改为链接或短映射，
不复制完整规则。

## Constraint Boundary

外键、枚举、同 revision 引用、append-only 和事件序列等结构不变量由 SQLite
约束。Review outcome 路由、fact/blocker 语义和 command CAS 原子集合由 reducer
contract 校验。Taskcraft 不校验 Agent 的外部权限，也不执行 probe 或 subagent
派发。每项保留规则都必须列出 enforcement owner。

## Failure Behavior

无效 transition 返回稳定错误与 remediation，事务零部分写入。宿主 Hook 或
原生结构化输出失败时明确报错，不改变任务事实。缺少输入或用户决定时形成 typed
blocker；secret 不写 Task Store。

## Review Strategy

每个决策用“ADR -> lifecycle/architecture -> CLI -> SQL/Schema -> plan”矩阵审阅。
若某一列无消费者，明确标为 not applicable；不得留空后假定由实现补齐。
