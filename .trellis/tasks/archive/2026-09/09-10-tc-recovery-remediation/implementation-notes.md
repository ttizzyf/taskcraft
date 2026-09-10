# 实施与验证记录

- Claude Entry 使用 stream-json/verbose 与宿主专属事件解析；复用既有 breadcrumb validator，模型复述不能判为注入成功。
- 共享 Node Brief builder 移至 src/core/node-brief-query.ts；task show 返回当前已领取卡，从持久化 Review link 恢复上下文，复用同一只读 Spec drift。
- 各节点完成路径共用 immutable stored schema 校验和字段诊断，移除 L3 静态重复校验；查询与失败提交保持零写入。
- 定向 Entry 66 项、恢复 35 项通过；集成 tests 73 文件 506 项通过，产品 typecheck/lint/format/build 通过。Watch 首次被沙箱 listen EPERM 阻断，正常监听权限下桌面/移动 6 项全过。
- 全仓 pnpm typecheck 的产品检查通过，用户并行 evals 子检查当时存在类型错误；未修改 evals 或其配置。
- 独立 trellis-check 代码审查无阻断发现。真实隔离重测使用同一源码构建及 deepseek/deepseek-v4-flash；结果见 development/evaluations/claude-entry-l2-recovery-2026-09-10.md。

不自动提交 Git。测评原始材料经独立核对后清理，仅保留报告与本任务相关产物。

## 真实重测发现的审计误报

受控返工产生两次成功内嵌 Record，最终任务 done，但原构建 doctor 错误要求同一条
节点级 Spec Impact obligation 分别引用两次 attempt。这与 satisfyObligation 的
既有幂等语义矛盾；两次 Record/Impact 均存在，不是丢写。最小修复保持写入合同，
义务按 revision/node 核验，Impact/result 仍逐 attempt 校验，并保护证据归属。
六个模型会话原始结果保留；修复后只读重查原数据库，不加第七会话、不修改原事实。

最终 doctor 定向24项、独立构建全量74文件514项通过；产品type/lint/format/build通过。
真实原库只读doctor自然/受控均11项通过，DB/WAL/SHM哈希不变；没有第七模型会话。
独立证据审查完成，临时项目/数据库/两份runtime/控制脚本/原始日志均已清理。
报告保留原测doctor误报、控制器清理异常、repair截断卡和finding字面路径瑕疵。
