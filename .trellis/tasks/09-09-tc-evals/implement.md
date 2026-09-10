# 实施与验证

## 当前工作：独立 Evals 看板

整体目录整理已完成：按用户最新要求停止尚未改文件的子代理，主会话直接完成 20 个文件迁移。根目录只保留 CLI、TypeScript 配置与 README；实现归入 core/、hosts/、graders/、reporting/，引擎测试集中 tests/，案例测试位于 tests/cases/，保留 board/ 与 runs/。同步静态引用、Pi worker 动态路径、源码指纹读取路径和当前文档，无行为/验收修改或旧路径转发壳。迁移快照 `/Volumes/PortableSSD/Dev/pi/tmp/tc-evals-organize-9l2_26zt`，逐文件diff仅引用/路径/格式差异；12个真实JSON/MD报告的SHA256全部不变。79项Evals测试、4项浏览器测试、typecheck:evals、eslint、prettier、eval --list和git diff --check通过；未重跑模型、未暂存提交、未改无关WIP。未来指纹按新路径源码生成，历史报告保留原指纹。

目录整理（用户要求看板文件不要平铺）：15 个看板文件迁入 `evals/board/`，服务与数据模块在该目录，页面资源在 `public/`，单元/API/浏览器测试在 `tests/`。更新 CLI 引用、静态文件白名单、默认报告路径、Playwright 入口与 README；测评执行器、评分器、案例和真实报告原位保留。迁移前快照 `/Volumes/PortableSSD/Dev/pi/tmp/tc-evals-layout-5z9h_hfr`，逐文件对比确认仅目录、引用、静态 URL 和测试发现配置调整。73 项 Evals 测试、4 项浏览器测试、typecheck:evals、eslint、prettier、git diff --check 通过；启动入口仍为 `pnpm eval --watch`。

本轮信息补全（用户要求背景、场景、标准必须可见）：新增 `evals/board/guide.ts` 集中保存三个场景的中文说明与逐项验收解释，`board/public/guide.js` 渲染可折叠详情。列表说明具体 CSV 开发任务，详情含背景、tc 能力目标、输入输出示例、完整需求、实际验收样例、执行步骤与覆盖范围。未运行场景同样可读；当前完整标准和本次检查结果分开显示，历史原始任务要求与逐项证据可展开。轮询无变更时不重建页面，有新数据时保持展开、滚动与阅读焦点。新增独立浏览器用例验证空历史说明和数据变化时阅读状态；本轮 12 项数据/API 测试、4 项桌面/移动/历史/折叠浏览器测试、typecheck:evals、eslint、prettier、git diff --check 通过。当前真实 reports 未改写，未调用模型，未修改 Watch/Store 或其他工作区改动。

交付收口：独立看板已完成并启动于 `http://127.0.0.1:3100/`。正式资产仅在 `evals/` 与必要工具入口；未接入 Watch、Store 或模型执行。概览、历史、逐项对比、证据展开、损坏报告提示和桌面/移动端均可用。真实报告仍为一个 delivery 执行受阻、两个未运行；没有生成或伪装真实通过历史。

独立检查修复了坏字段报告导致全页加载失败、合成历史污染真实 runs、judge 出错抹掉可靠 code 失败、实际 judge 模型未记录、逐项检查对齐问题。检查子任务 `de645860-d0ea-417d-8bc8-42af2a2f994e` 在全部验证后输出报告时超时；主会话保存快照 `/Volumes/PortableSSD/Dev/pi/tmp/tc-evals-board-review-timeout-f1gwjs0s`，通过同协议恢复为 `fe72557d-5352-4be7-9b6e-6b921939b302`，已返回完整检查报告，无剩余阻断项。

主会话最终补齐实际验收/提示源码指纹、残缺元数据不可比、实际模型优先且恢复各阶段模型须一致，并把桌面六张概览卡片排为一行。最终 Evals 11 文件 / 73 测试、3 项 Playwright 浏览器测试、Evals typecheck/eslint/prettier 和 git diff --check 全部通过。独立检查阶段全项目 85 文件 / 585 测试与 pnpm typecheck 通过；最后局部修正后复跑受影响的 Evals 与浏览器检查。截图在 git-ignored `test-results/evals-smoke-*.png`。源码散列保守，注释变更也会使相关条件不可比；未跑真实成功 Agent/Judge 链路，真实运行之间的进退仍待后续有有效数据后验证。工作未暂存/提交，任务未归档，所有无关 WIP 保持原样。

原框架已交付；用户在概览方案后确认独立实现且 evaluation harness 不关联 tc Watch。以下是当前步骤，后文保留原实现证据，不重做原框架。

1. 按设计完成 evals 内独立数据/对比模型、轻量服务器和 CLI --watch；补可选报告 provenance，保持历史读取。
2. 完成中文概览、历史与详情、变化对比；看板统一放在 evals/board，浏览器资源与测试分别放 public/、tests/，不引入前端框架。
3. 针对性 unit/API 测试与实际 Playwright 桌面/窄屏 smoke；新增脚本如 smoke:evals 及 evals 内独立测试配置。严禁使用真实 runs/ 写合成历史来展示进步。
4. 独立审核误导性失败、不可比的进步结论、数据读取/HTML转义、移动视图；修正具体缺陷。
5. 跑适用检查并启动真实只读看板供用户浏览。无需重跑受模型服务阻塞的开发 Agent 实验。

允许编辑 evals/**、必要 package.json/现有工具链配置。禁止改 src/**、watch/**、tests/watch/**、playwright.config.ts（属于 agent harness）。父会话负责本任务文档。保留其他会话已有 WIP，当前 main@de04153b0dd24c393800433b3857ad86fd499909。一个 writer 顺序实现后独立检查，不新建未经批准的架构模块。上轮35→43项 Evals测试的主会话修复均已在当前文件中，不能被回退。

## 原框架实施记录

1. 读取 prd/design、.trellis/spec/backend/index.md、.trellis/spec/taskcraft.md、共享 guides，确认现有 CLI/测试约定。
2. 在 evals/ 实现 3 案例的共享 fixture、独立验收、薄宿主封装与 code/model grader，接 pnpm 入口；保持少量目录，不扩展产品 src。
3. 加入自动测试，确保已知错误代码不通过、模型错误不变为通过、恢复缺检查点不能算已测、运行状态与最终判定清楚。
4. 运行针对性测试（60s timeout）、typecheck、lint、format 检查与构建，修复范围内问题。
5. 通过框架尝试一个真实 delivery smoke（建议首会话 180s，judge 60s；可用后再跑另外两个），按结果如实记录。若模型服务失败不切换路由，不把它当 tc 失败。
6. 独立 review/simplification；只修本次具体缺陷，复跑受影响检查；最终检查 git diff、未追踪正式资产及既有改动。
7. 文档只需 evals/README.md 为长期入口，根 README 加链接。规划状态/已知问题留本任务，正式运行不依赖 .trellis。

## Ownership

当前 main 非干净：已有 Hook 文档、CLI 测试、工作日志和历史 evaluations 报告未提交，来自其他工作。保持原样，不执行 git reset/clean/checkout，不提交或覆盖未知改动。允许本任务编辑 evals/**、package.json、tsconfig.json、vitest.config.ts、eslint.config.mjs、.gitignore、README.md；任务规划由主会话负责。默认一位 writer；后继 checker 只有前位结束后才能写。

## Commands

- `pnpm build`
- `pnpm exec vitest run <新增 eval 测试路径>`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm format:check`
- `pnpm test`（最终一次全量；无产品改动不需浏览器 smoke）
- `pnpm eval --list` 与一个真实案例
- `git diff --check`

测试 exact paths / CLI 以实现后的入口为准。Model 服务失败应报告到本次运行记录，不自动扩展为 adapter 修复任务。不得调整审批、个人凭据和 provider 配置。

## Final delivery checkpoint

实现与独立检查已完成；正式资产在 evals/，三个案例为 delivery/recovery/review。实际 CSV 任务是聚合 `name,amount` 并处理引号字段。首版均使用 L1 任务记录；review 案例测代码审查与修复，不声称覆盖 L2 tc review 回流。扩展方式与这一边界集中记录在 evals/README.md，不新增分散的产品规范文件。

主会话最终收口：修复 Commander camelCase 选项读取（judgeModel/actorTimeoutMs/judgeTimeoutMs/runDir），显式拒绝非法预算、解析 --tc 相对路径；把 evals 类型检查接入 pnpm typecheck；为重复名称覆盖而非累加的实现补负例；统一中断与超时的进程组 SIGTERM/SIGKILL 处理，验证忽略 SIGTERM 的受控 fake host 仍被正确判为 interrupted。

最终验证：Evals 7 文件 / 43 测试通过；全项目 77 文件 / 525 测试通过（含前置构建）；pnpm typecheck、lint、format:check、git diff --check 通过；pnpm eval --list 正常列出三个案例。工作未暂存/提交，任务未归档。

真实 smoke 留存在 `evals/runs/delivery-2026-09-09T11-29-30-582Z.{json,md}`：actor error，judge error，总体 inconclusive。stderr 含 unrecognized_model 警告，但原报告未保存完整终态错误，所以不把警告当作已证实根因。后续诊断保存已补齐。真实 recovery/review 未跑，完整真实 Agent + judge 成功链路仍未验证；本次没有更换宿主模型路由重跑。

## Implementation retry checkpoint

首个实现 workflow `5b152f62-d54f-4fff-961e-d0d3cd05b244` 的 child `b9c7e001-5f18-453f-a9f6-f82055af25d9` 因 `Subagent timed out after 1800000ms` 失败；独立检查尚未启动。已有 11 个 evals 文件（workspace/host/tc/types/model-grader、CSV 与三案例），没有修改 tracked 工程配置，尚缺入口、文档和测试。

2026-09-10 Luna/max 真实执行方案：在 `evals/` 新增 Pi SDK worker/host，动态加载已安装 `@earendil-works/pi-coding-agent`，通过 `ModelRuntime` 读取现有 company provider、模型注册和认证，不改个人配置；每次 actor/judge 在独立 Node 子进程中创建 `SessionManager.inMemory()` 会话，worker 禁用资源发现，actor 只开 read/bash/edit/write，judge 不开工具。父 host 保持现有 `HostRunRequest`/`stopWhen`/超时边界，独立进程组负责 SIGTERM→SIGKILL，中断时保留 recovery 检查点。增加显式 Pi host 选择与 `thinking=max` 透传，报告分离 requested provider/model/effort 与响应实际 provider/model/api/providerThinkingLevel/usage 观测，恢复前后模型条件保持一致。先做 host/解析/CLI 针对性测试、build/typecheck/lint/format，再按 delivery→recovery→review 顺序真实运行；只在真实证据支持时重跑，所有报告保留于 `evals/runs`，最后用只读 board API 核对记录可见性。

2026-09-10 收尾：浏览器 legacy smoke 改用系统临时目录中的旧 delivery JSON 原文副本，保留完整 `attempted=1/blocked=1/unrun=2` 断言，不读取或清理真实 `evals/runs`；合成比较继续使用独立 tmpdir。真实 delivery/recovery/review 均以请求 `company/gpt-5.6-luna:max`、actor 600000ms、judge 180000ms 通过，初始 180000/60000 超时报告保留；只读看板/API 服务端不调用模型，也不回显模型请求。

2026-09-09 已将 tracked diff 与所有 evals 文件保存到 `/Volumes/PortableSSD/Dev/pi/tmp/tc-evals-timeout-5jt8gvgo`（含 SHA256 manifest）。仓库 `/Users/wangjie/StudioProjects/taskcraft`，唯一 worktree，main@de04153b0dd24c393800433b3857ad86fd499909；既有 WIP 保留。通过同一 subagent workflow 协议重试，改用 DeepSeek 接续，Luna 独立检查。禁止另起外部实现代理绕过失败；使用新框架运行真实测评属于已授权验收。
