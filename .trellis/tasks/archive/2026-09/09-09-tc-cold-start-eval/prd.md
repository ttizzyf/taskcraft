# Claude Entry 与 L2 冷启动恢复测评

## Goal

验证当前 tc 在真实 Claude Code 中的 Entry 注入，以及真实 L2 修改在执行中断和审核返工后由全新会话接手的能力，为狗粮化迁移提供证据。

## Background

- 用户授权两条测试并行；被测 Agent 不得获知测评目的；结束仅交付报告，临时开发产物不保留。
- 本机 Claude Code 2.1.237，`claude auth status` 显示已登录；Node 24.8.0、pnpm 10.33.0。登录探测不证明模型请求成功。
- 当前 main 为 de04153，工作区已有 9 个文档/测试修改，必须保留。
- `src/adapters/claude.ts` 调用真实 Claude；`src/adapters/shared.ts` 的公共 Entry 检测为 60 秒超时，以成功退出和输出包含 breadcrumb 判定。
- `src/hooks/entry.ts` 只注入唯一 active 根任务；`src/commands/task-show.ts` 提供结果与证据；`src/core/projector.ts` 对执行中节点可能返回 complete 命令，不能把该命令当作已完成的证明。

## Requirements

1. 使用当前源码独立构建的 tc，在仓库外临时项目运行；产品源码与宿主全局配置不修改。
2. Entry 检测先原样执行公共命令。失败时只做诊断，独立报告命令结果与实际 Hook 可观察性，不修改产品让检测通过。
3. L2 使用真实代码和真实测试；在执行中途和审核返工后分别启动无历史的新 Claude 会话，只提供普通继续工作请求和正常项目上下文。
4. 控制器事先固定验收与切换条件。被测 Agent 不读取测评任务文档、评分脚本、其他会话日志或隐藏答案；任何污染均记录，不纳入有效通过。
5. 任务和审核事实只通过公共 tc CLI 写入，不直接写数据库；必要的受控缺陷起点明确标为人工构造，不能冒充 Agent 自然产生的错误。
6. 报告区分 pass、fail、blocked、not-exercised，保留必要脱敏证据、环境信息、提示词、干预记录与样本局限。
7. 最终保留一份 `development/evaluations/claude-entry-l2-recovery-2026-09-09.md` 和必要 Trellis 管理记录；清理本次创建的临时代码、数据库、评分脚本及原始日志，不删除用户已有宿主历史。

## Acceptance Criteria

- 公共 Entry 命令的退出码、耗时、结果及失败诊断可核验。
- 两个恢复检查点分别报告：任务定位、节点判断、已有产出读取、实质推进、结果登记真实性。
- 审核返工由真实 reviewer 针对明确需求和可复现问题作出；不得要求 reviewer 为制造回路而假判失败。
- 被测代码通过独立验收才可认定交付正确；tc done 与代码正确分别评分。
- 只称为单案例探索性测评，不以一次成功推断稳定性或整个迁移门通过。
- 报告完成后确认临时资源已清理，原工作区修改保持原样。

## Out of Scope

修复 tc、卸载 Trellis、修改迁移门、修改个人配置、发布代码、保留示例产品、多模型性能排名。
