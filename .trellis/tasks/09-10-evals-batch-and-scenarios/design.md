# Design

## Architecture

保留 runEval 单案例流水线。批量执行是一个普通 Node CLI：展开不可变作业清单 → 有界调度 → 每 job 独立执行/工作区/报告目录 → 原子保存批次记录。无后台 daemon，无 Task Store 写入入口新增。

公共交接尽量沿用 EvalCase/EvalContext/EvalReport。批次模块单独拥有自己的类型和解析器；看板使用纯展示 DTO，由集成阶段接线。父代理只处理任务记录、Git 分支/worktree、派发和最终发布，业务实现交给子代理。

## Batch behavior (lane A)

- 保持 --case <id>、--agent-host、--watch/--host 等既有参数；增加 --all、--cases <comma-separated>、--repeat <N>、--concurrency <N>、--resume <batch-id>。默认 repeat=1、concurrency=2。旧单案例无批次参数继续原行为；--all/--cases/repeat/concurrency 请求进入批次。
- batch 目录为 <runDir>/batches/<batchId>/；batch.json 原子写入，job 报告放独立子目录防止并行时间戳冲突。清单保存解析后的案例、模型、宿主、预算和重复次数。
- job 终态包括 pass/fail/inconclusive（或 finished+verdict 的等价表示）；排队/运行独立于评分。harness 异常必须保留诊断并计入 inconclusive，不能伪造成产品失败。
- --resume 使用保存配置，拒绝修改执行配置；已完成的 pass/fail/inconclusive 全部跳过，崩溃时未完成 job 才补跑，旧尝试的文件保留。活动批次需有所有权防止两个 dispatcher 同时续跑；不能仅凭目录存在锁死崩溃批次。
- SIGINT/SIGTERM 停止新派发，取消当前工作并落盘；确保 Actor/judge/tc 后代不会遗留。优先每 job 子进程做取消边界，可复用现有进程组行为，不引入一整套 runtime。
- 提供明确的加载/解析导出让集成者读取批次，报告中保留真实 Git SHA。源文件指纹仍遵循现有保守策略，不增加被测构建 hash。

## Verdict and board (lane B)

- aggregate 必須至少一条必要 code 检查，缺失为 inconclusive；已取得的 hard code fail 仍优先。
- 删除单样本改善/退步的能力暗示，用结果变化描述；有 inconclusive 时不排序为较差结果。条件未知/预算不一致仍不可比。
- 看板并行实现纯计数/展示 DTO，不依赖尚未生成的 A 模块。BoardPayload 可新增可选 batches，字段：id、status、createdAt、caseIds、total、pass、fail、inconclusive、pending、running、diagnostics。其中 total=五种作业状态总和。批次是原始样本计数，不把预算不同的批次合成提升结论。
- 提供批次区块、中文计数、空状态；集成阶段将 A 的批次记录映射为此 DTO，并让批次内部报告可浏览。旧报告、场景描述、滚动/展开状态保留。

## Blind judge (lane C)

judge 只读取任务要求、实际产物、执行/中断事实和必要任务事实，不看 codeChecks 的 verdict/reason，也不看最后的汇总判定。调用签名暂时兼容以免与 lane B 的 runner 文件冲突；最终由集成者清除不再需要的输入。固定 rubric、严格 schema 校验、无工具、无法核实记 inconclusive 均保留。用固定的清晰正确/错误/证据不足样本验证证据组织，独立审查只能称子代理复核，不声称人工 gold set 已校准。

## New cases (lanes D/E)

- D: case id l2-review，导出 l2ReviewCase。使用真实 tc CLI 和小型 CSV 工作负载，合理预置缺陷并披露 fixture 来源。至少发生 delivery Review 的 changes_requested → successor Execute → 新 Review passed → Record。审查必须由实际独立会话执行，能力/独立性如实披露；不可把控制器写死的结果算成模型审查。完成验收检查产物、Review links、attempt 关联和历史。可在 core/tc.ts、core/types.ts 最小增加 task show 中的 Review 字段，不能访问 SQLite。
- E: case id session-resume，导出 sessionResumeCase。首次真实 host session 正常 success 退出，持久任务未完成且已有可验证工作；随后全新 session 不带 task id、原需求或前次聊天，依靠 README 与 tc durable state 续做。检查首次正常结束、任务/attempt 身份、最终产物及闭合事实。不得误用 recovery 的 interrupted checkpoint 声称此场景完成。
- 两条 lane 各新增独立案例源文件/辅助文件/测试；不改 cases/index.ts、board/guide.ts、README。向集成者交付准确的中文场景信息。

## File ownership

| Lane            | Allowed mutation                                                                                                                       | Deferred to integrator       |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| A batch         | evals/cli.ts、evals/core/batch*.ts、evals/core/job*.ts、evals/reporting/batch*.ts、evals/tests/batch*.test.ts、evals/tests/cli.test.ts | board、README、case registry |
| B verdict/board | evals/core/runner.ts、evals/tests/runner.test.ts、evals/board 下除 guide.ts 外实现和测试                                               | A 模块数据接线、新场景文案   |
| C judge         | evals/graders/model.ts、evals/graders 下新增判分辅助文件、evals/tests/model-grader.test.ts 与专属 fixtures/tests                       | runner 的参数清理            |
| D L2            | evals/cases/l2*.ts、evals/tests/cases/l2*.test.ts、evals/core/tc.ts、evals/core/types.ts                                               | registry、guide、README      |
| E resume        | evals/cases/session-resume*.ts、evals/tests/cases/session-resume*.test.ts                                                              | registry、guide、README      |
| integration     | 集成分支的本任务所有必要接线、provenance source 清单、新场景指南、README、脚本                                                         | 禁止无关产品重构             |

## Compatibility and verification

不修改历史 reports。旧 v1 报告可读取，新增结构必须兼容缺失字段。动态 fingerprint 不得假设新 case 的 helper 文件自动入指纹；集成者检查实际执行/验收来源被覆盖。场景测试使用 fake host 驱动真实 CLI，不能调用付费模型或把 fake 结果写入正式 runs。最终跑完整项目测试、类型、lint、format、build、Evals 桌面/移动 smoke 和 HTTP 请求。
