# 修复 Entry 检测与冷启动结果恢复

## Goal

修复已证实的 Claude Entry 检测误报，并让没有旧聊天上下文的 Agent 能通过正常任务查询取得当前执行卡、理解结果格式错误，随后重走隔离的 DeepSeek 测评。

## Background

- 用户于2026-09-10同意先修复再重测。此前报告为 `development/evaluations/claude-entry-l2-recovery-2026-09-09.md`。
- Claude adapter缺少stream-json，公共检测依赖stdout中的breadcrumb，真实宿主已成功时仍报失败。
- 本轮只读复现：execute已领取时next=complete、task show无Node Brief；错误JSON只收到笼统提示。再次run可取得结果schema，revision仍4、attempts不变。
- 上次控制器字符串message解析异常及过窄命令许可影响了评测，不能当作tc功能缺陷。
- `tc-evals` 是用户另行开发的系统；当前已有多处未提交修改。本任务独立管理，不改该任务和evals实现。

## Requirements

1. 公共Claude Entry检测能观察真实SessionStart事件；宿主失败、Hook失败及无有效breadcrumb不能判通过。
2. 现有冷启动详情查询提供当前已领取节点的完整执行卡，含采用的规范、目标、验收要求和结果格式；查询不创建attempt、不变更revision。
3. 格式错误明确指出字段/路径及约束，并提供可直接执行的取卡指引；校验仍来自该revision保存的唯一schema，失败不写事实。
4. 保留next的正常流程语义、五种任务状态和既有结果合同；不为恢复再建一份任务状态或执行卡模板。
5. 更新直接相关合同及回归测试。测试保护既有run重取卡幂等性、历史revision校验和Review关联。
6. 以用户指定的deepseek/deepseek-v4-flash在独立临时项目重测公共Entry、执行中断恢复、审核返工恢复。被测只接收正常需求与普通继续提示；评分、测评目的不注入。
7. 控制器健壮处理事件格式并在异常/超时时停止自身进程；正常项目内验证命令可执行，不用不必要许可限制制造测评失败。真实拒绝如实记载，不跳过所有权限。
8. 保留修复代码、回归测试、相关规范与新报告；临时被测项目、数据库和原始日志取证后清理。不改全局模型配置、不操作用户另行运行的evals系统。

## Acceptance Criteria

- 回归测试证明正常Claude事件成功、失败事件/仅模型复述标记不会误判。
- 冷启动task show获得与run同源的已领取Node Brief；重复查询不改变revision、attempt/event数量。Review卡引用正确被审attempt；L3子任务仍按既有next定位。
- 缺字段、错误类型、额外字段返回具体诊断及取卡命令，失败保持零写入。
- 定向测试、typecheck、lint、build通过；对相关Watch/Adapter共享消费做必要回归。
- 新报告按实际结果标明pass/fail/blocked/not-exercised，不合并不同起点、不以受控样本替代自然样本；只报告本模型本案例证据。
- 既有用户修改与evals工作保持原样；临时资源清理完成。

## Out of Scope

卸载Trellis、改变迁移门、改造用户evals系统、增加新任务状态、变更结果schema语义、云端/多模型平台、提交Git。
