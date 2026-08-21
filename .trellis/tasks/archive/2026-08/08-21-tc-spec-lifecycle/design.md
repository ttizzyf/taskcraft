# Design

迁移新增 `lifecycle_spec_bindings` 与 `spec_impact_results`。Binding 的目标为精确
task/revision/node/spec，保存 kind/path/digest/duty 和 source provenance，更新/删除被
trigger 拒绝。旧行不回填；新 compiler version 才生成新义务。

CLI/service 使用 Registry resolver 将 id 解析为 snapshot，再调用 reducer。L1 初始
绑定到 Execute/Record；L2 初始绑定只服务 Frame，Frame 完成事务追加 Execute/Review/
Record；L3 planning context 在 task new 绑定，accepted Plan 为 execution revision 和
children 原子物化。所有 target node 在 binding 形成前不可 runnable。

刷新使用新的 lifecycle revision，不修改 binding。standalone clone 当前合同；L3
modules 或 inherited child 转到 root planning revision，复用现有 replan 原语并记录
old membership 为 not_required。
