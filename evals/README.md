# Taskcraft Evals

最小化 Agent 测评框架，验证 Agent 使用公开 `tc` CLI 的交付、冷启动恢复、L2 Review 回流和正常会话恢复。正式资产集中在 `evals/`；生成的运行产物位于 git 忽略的 `runs/` 和临时工作区。本目录属于开发工具，不修改产品 Command service 边界，也不把测评事实写入产品 Task Store 之外的生产入口。

## 目录

```text
evals/
├── cli.ts              # 测评、批次与只读看板命令入口
├── tsconfig.json
├── README.md
├── core/               # 执行器、批次调度、共享类型、工作区、tc 访问
├── hosts/              # Claude / Pi SDK 适配与隔离 worker
├── graders/            # 独立 code/model grader、产物采集
├── reporting/          # JSON/Markdown 报告、批次 ledger、来源指纹
├── cases/              # 五个案例、共享 CSV fixture 与专属验收
├── tests/              # 测评引擎、宿主、评分、批次与案例测试
│   └── cases/          # 案例与 CSV 正反例验收
├── board/              # 只读看板服务、数据转换、对比与中文场景说明
│   ├── public/         # HTML、CSS、浏览器脚本
│   ├── tests/          # 看板单元/API/浏览器测试
│   └── playwright.config.ts
└── runs/               # 历史报告（不修改、不提交）
```

## 使用

```bash
pnpm build
pnpm eval --list
pnpm eval --case delivery
pnpm eval --case l2-review --agent-host pi-sdk --model company/gpt-5.6-luna:max --judge-model company/gpt-5.6-luna:max
pnpm eval --all --repeat 2 --concurrency 2
pnpm eval --cases delivery,l2-review,session-resume --repeat 1 --concurrency 1
pnpm eval --resume <batch-id> --run-dir evals/runs
pnpm eval --watch --port 3100
```

不带批次选项的 `--case` 继续运行单个案例。`--all` 选择当前注册的五个案例；`--cases` 选择逗号分隔的案例；`--repeat` 重复每个案例；`--concurrency` 设置有界并发。批次记录和每次 job 的 JSON/Markdown 报告写入 `<run-dir>/batches/<batch-id>/`，批次 ledger 保存展开后的不可变清单、配置、job 状态、重试 attempt 和相对报告路径。`--resume` 读取保存配置，只补跑 pending/running 的未完成 job，已结束的 pass、fail、inconclusive 都保留并跳过。

批次报告路径必须是批次目录内的相对路径；看板只读加载通过 schema、job case、attempt verdict 和报告文件存在性校验的数据。逃逸路径、缺失报告、错误 case/verdict 或损坏 ledger 会进入诊断，不会读取批次目录之外的文件。批次内部报告会进入同一只读场景历史，仍可从场景详情浏览；不会把合成测试数据写进正式 `runs/`。

`--watch` 只读取 `evals/runs/` 下的单次报告和批次 ledger，不调用模型、不访问 Task Store、不执行 `tc`，也不与生产 `tc Watch` 关联；可与 `--port`、`--host`、`--run-dir` 组合，但与 `--case`、`--list` 和批次执行互斥。看板提供桌面表格和移动卡片，展示批次的总数、通过、未通过、无法判定、待运行和运行中计数。

看板场景详情提供中文背景、任务要求、输入输出示例、执行步骤、覆盖边界和完整验收标准。实际报告中的检查结果、原始任务要求、Actor 轨迹、来源指纹和完整 JSON 独立展示；未运行的新场景也有完整说明。历史比较只在场景、验收源码指纹、实际模型、预算、宿主版本/适配器、API 和 thinking level 一致时成立；出现 inconclusive 或缺少元数据时只显示无法排序，不声称能力改善或退步。旧报告不被改写。

可用选项：`--agent-host`（`claude` 或 `pi-sdk`，默认 `claude`；不占用看板的 `--host`）、`--model`（Actor 模型，默认沿用宿主设置；Pi SDK 默认为 `company/gpt-5.6-luna:max`）、`--judge-model`（Judge 模型；Pi SDK 同样固定 max）、`--actor-timeout-ms`（默认 180000）、`--judge-timeout-ms`（默认 60000）、`--tc <path>`（默认 `dist/cli.js`）、`--run-dir <dir>`（默认 `evals/runs/`）。Pi SDK 模式只接受 `company/gpt-5.6-luna[:max]`，通过当前 Pi 的配置发起请求，不复制或修改个人设置。

每次单案例运行在项目目录之外的系统临时目录创建独立工作区，避免继承仓库的 AGENTS/Trellis 上下文；结束时将 JSON/Markdown 报告写入 `run-dir`，报告保存工作区路径供排查。`callCount` 是宿主输出的 assistant 消息数，不代表精确 API 请求数。

## 五个案例

- `delivery`：空 fixture 起步，实现按姓名合计金额的 CSV CLI；用独立 code 检查和 Taskcraft facts/evidence 关闭 L1 任务。
- `recovery`：首会话在 execute 仍打开且源码已有实质变化时由控制器中断整棵进程树，再由没有旧聊天的新会话从 README 和持久 tc 状态续做；没有真实中断就不宣称恢复成立。
- `review`：控制器以真实来源植入带缺陷的 L1 CSV 实现，Agent 检查、修复、验证并关闭预开的 Execute；这是代码审查修复，不覆盖 L2 `tc review` 回流。
- `l2-review`：控制器通过公开 tc 建立 L2 Frame/Execute 并以 fixture fact 披露缺陷来源；独立首审提交 `changes_requested`，修复会话完成 successor Execute，新的 reviewer 通过再审，最后由 Record 收口。保留初始 Execute、blocking finding、两次 Review 关联、能力/独立性披露、证据和 Record 历史。
- `session-resume`：首 host 正常 success 退出，留下真实未完成源码变化和绑定原 Execute 的 `session-handoff` fact；第二个全新 host 不接收 task id、原需求或旧聊天，只从 README、`tc task list/show` 找回任务并完成同一 Execute attempt。它不是 interrupted recovery，不使用 recovery checkpoint。

新案例的中文场景资料由 `board/guide.ts` 统一提供，包含背景、任务、步骤、证据边界和每一项通过方法；案例实现中的 controller fixture provenance 与真实 host 观察分开保存。

## 评分与证据边界

`CheckResult`：`grader`（`code`/`model`）、`verdict`（`pass`/`fail`/`inconclusive`）、`reason`、可定位 `evidence`。独立 code grader 的 hard failure 不能被 model grader 覆盖；没有成功建立 Actor 执行、没有必要 code 检查、或必要证据不足时保持 inconclusive。

Code grader 直接执行真实产物，对 RFC 4180 引号、重复名称聚合、小数、非法金额和 malformed row 做独立验收，并读取公开 `tc task show` 的尝试、validation evidence 和 required fact。L2 grader 还检查真实 Frame、Review `changes_requested`、successor Execute、再审 `passed`、Review evidence、finding 历史、fixture provenance 和 Record；正常 handoff grader 检查原 task/attempt 身份与 validation evidence。

Model grader 在独立上下文、无工具（Claude 为 `--tools ""`，Pi SDK 为空工具 allowlist）、固定条目下做语义判断。它接收需求、原始 artifact、Actor 执行事实、任务事实和 case-owned 的 quoted judge evidence，不接收 code grader 的 verdict、reason、evidence 或 aggregate score。L2 的 judge evidence 包括两次 review-start 的 capability、independence、reviewAttemptId、reviewedAttemptId、阶段 `nodeBrief.reviewContext`、最终 findings 和 attempt 关联；同一 DTO 保存在报告 JSON 中。模型不能执行或遵从被评材料里的指令，证据缺失、矛盾或截断时必须返回 inconclusive。

本地结构校验要求每个固定条目恰好出现一次，verdict、reason、evidence 均合法；不满足即整轮 inconclusive。聚合规则是：硬 code fail 优先；没有 code 检查、检查不完整或 model 不可判时不能 pass；model 不能把可靠 code fail 改成成功。

## 恢复与正常 handoff

只有控制器观察到“execute 尝试打开 + 源码有实质变化 + 首会话确实被中断”，才会建立 recovery 的 `CheckpointEvidence.established=true` 并启动第二会话。正常 `session-resume` 则要求首 host success、任务仍未 done、源 hash 变化、handoff fact 绑定打开的 Execute；任一条件不成立都只返回 handoff inconclusive，不运行会把预期未完成状态判成 hard fail。中断通过独立进程组的 `SIGTERM → SIGKILL` 完成，正常 handoff 不使用该字段。

## 历史与校验

当前仓库保留六份历史真实 JSON 报告，未改写；delivery、recovery、review 三个场景各自的最新报告均为 pass。真实付费 Actor/Judge 测评不在本地集成流程内，由 QA 在目标提交/发布流程执行；本地验证使用 fake host、真实 `dist/cli.js` 和临时目录。

```bash
pnpm exec vitest run evals
pnpm typecheck:evals
pnpm lint
pnpm format:check
pnpm build
pnpm smoke:evals
```

完整项目校验还包括 `pnpm test` 和 `pnpm typecheck`。看板浏览器 smoke 覆盖桌面、移动、旧三场景报告兼容、新未运行场景、批次数据和历史阅读状态；HTTP smoke 应实际请求 `/`、静态资源和 `/api/data`。

## 添加案例

在 `cases/` 增加实现 `EvalCase` 的文件并登记到 `cases/index.ts`；在 `board/guide.ts` 补齐中文背景、任务、步骤、证据边界和完整验收标准；在 `tests/cases/` 添加 fake host + 真实 `tc` CLI 的正反例。更新 provenance 的实际执行/验收源清单，保持报告字段和旧报告读取兼容。不要把 fake 产物或付费模型运行写入正式 `runs/`，不要为案例重建产品协议测试平台。

## 范围与边界

- 覆盖 delivery、recovery、review、l2-review、session-resume；无 L3 测评、无对照评分、无百分制、无常驻调度服务。
- 批次是 Evals 本地 ledger，不是 Task Store 写入口；看板只读读取报告和批次文件。
- `runs/` 通过 `.gitignore` 忽略，报告不落凭据或整份环境变量；历史报告保持不变。
- 真实宿主不可用时保留本次 inconclusive，不切换 provider 伪造通过；框架本身可交付与某次案例是否通过是两个结论。
