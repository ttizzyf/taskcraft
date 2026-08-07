# Design: Runtime Contract Freeze

## Update Order

先更新唯一语义规则源，再更新消费者：

1. `lifecycle.md`：activation、node/review/outcome/revision 语义。
2. `architecture.md`：事实归属、reducer/projector/Adapter 和安全边界。
3. `product.md`：只同步用户旅程与可见行为。
4. `cli.md`：把语义映射为 command transition、JSON 和稳定错误。
5. `storage.sql` 与 JSON Schema：实现可由存储层强制的结构约束。

这种顺序避免 CLI 或 SQL 反向定义产品语义。跨文件相同段落改为链接或短映射，
不复制完整规则。

## Constraint Boundary

外键、枚举、同 revision 引用、append-only 和事件序列等结构不变量由 SQLite
约束。actor independence、finding 的 R1/R2/R3 语义、授权适用性和 command
CAS 原子集合由 reducer contract 校验。每项 ADR 都必须列出其 enforcement
owner。

## Failure Behavior

无效 transition 返回稳定错误与 remediation，事务零部分写入。未验证宿主
能力只降低 capability 状态，不改变任务事实。缺失授权/输入形成 typed blocker，
不得通过默认值继续执行。

## Review Strategy

每个决策用“ADR -> lifecycle/architecture -> CLI -> SQL/Schema probe”矩阵审阅。
若某一列无消费者，明确标为 not applicable；不得留空后假定由实现补齐。
