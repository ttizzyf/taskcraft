# Taskcraft Evals

最小化 Agent 测评框架，验证 Agent 使用公开 `tc` CLI 的正常交付、冷启动恢复和审查修复。正式资产集中在 `evals/`，按执行核心、宿主、共享评分、报告处理、案例、看板和测试归类；生成的运行产物位于 git 忽略的 `runs/`。本目录不依赖 Trellis；框架属于开发工具，不修改产品 Command service 边界。

## 目录

```text
evals/
├── cli.ts              # 测评与看板命令入口
├── tsconfig.json
├── README.md
├── core/               # 执行器、共享类型、工作区、tc 命令访问
├── hosts/              # Claude / Pi SDK 适配与隔离 worker
├── graders/            # 共享模型评分、评审产物采集
├── reporting/          # JSON/Markdown 报告生成、来源指纹
├── cases/              # 三个案例、共享 CSV fixture 与专属验收
├── tests/              # 测评引擎、宿主、评分及报告测试
│   └── cases/          # 案例与 CSV 验收测试
├── board/              # 看板服务、数据转换、对比与场景说明
│   ├── public/         # HTML、CSS、浏览器脚本
│   ├── tests/          # 看板单元/API/浏览器测试
│   └── playwright.config.ts
└── runs/               # 生成的报告（不提交）
```

## 使用

```bash
pnpm build          # 先构建 dist/cli.js（测评调用该产物）
pnpm eval --list    # 列出三个案例
pnpm eval --case delivery   # 跑一个案例，输出到 evals/runs/
pnpm eval --case recovery --model <model> --judge-model <judge>
pnpm eval --case delivery --agent-host pi-sdk --model company/gpt-5.6-luna:max --judge-model company/gpt-5.6-luna:max
pnpm eval --watch   # 启动独立只读看板（默认 http://127.0.0.1:3100/），实时浏览 evals/runs/
```

`--watch` 只读取 `evals/runs/` 下的 JSON 报告，不调用模型、不访问 Task Store、也不与 `tc Watch` 关联；可与 `--port`、`--run-dir` 组合，但与 `--case`、`--list` 互斥。

看板列表说明每个场景要完成的具体工作；详情提供背景、任务要求、输入输出示例、执行步骤、覆盖范围与完整验收标准，未运行时也可展开查看。每次运行的实际检查结果单独展示，含中文名称、标准与证据；历史报告保存的原始任务要求可展开，避免把当前场景说明当成历史事实。

历史对比要求已知且一致的场景、验收源码指纹、实际模型与预算；可观测的宿主版本、宿主适配器、API 与 thinking level 也参与比较。命令行模型别名仅保留作配置记录，模型未观测到或恢复各阶段模型不一致时不可比。被测 tc 提交单独展示，不混入测法指纹；源码指纹采取保守策略，相关文件即使只改注释也会视为条件变化。旧报告不被改写，缺少元数据时显示不可比。目录迁移也会改变源码及路径指纹；历史记录保留当时的指纹，未来运行按新路径生成，不为了保持可比而重写旧报告。

可用选项：`--agent-host`（`claude` 或 `pi-sdk`，默认 `claude`；不占用看板的 `--host`）、`--model`（actor 宿主模型，默认沿用宿主设置；Pi SDK 模式默认为 `company/gpt-5.6-luna:max`）、`--judge-model`（judge 模型；Pi SDK 模式同样固定 max）、`--actor-timeout-ms`（默认 180000）、`--judge-timeout-ms`（默认 60000）、`--tc <path>`（tc CLI，默认 `dist/cli.js`）、`--run-dir <dir>`（默认 `evals/runs/`）。Pi SDK 模式只接受 `company/gpt-5.6-luna[:max]`，通过当前 Pi 的 `models.json`、`auth.json` 和 `ModelRuntime` 发起请求，不复制或修改个人配置。

每次运行在系统临时目录（项目目录之外，避免继承本仓库的 AGENTS/Trellis 上下文）创建独立工作区，结束时把 JSON 与 Markdown 报告写入 `evals/runs/`。工作区保留供排查，路径记录在报告中。`callCount` 统计宿主输出的 assistant 消息数，用于粗略比较，不代表精确 API 请求数或工具调用数。

## 跨平台（macOS / Windows）

框架在两个平台上的行为一致，平台差异集中在 `core/process.ts`、`core/workspace.ts` 与
`hosts/claude.ts`，由 `process.platform` 分支处理，不依赖任何硬编码的绝对路径：

- 命令启动：Windows 无法 `CreateProcess` npm 安装的 `.cmd` shim，也不能用 `shell: true`
  （cmd.exe 会重解析参数，把 JSON 载荷的引号剥掉、把 `Bash(tc *)` 拆成两个参数）。统一走
  `cmd.exe /d /s /c` + 逐参数转义，空参数显式写成 `""`——否则它会从命令行里消失，
  导致 `--tools ""` 吃掉后面的 `--model`。
- 进程中断：POSIX 用负 pid 给 detached 进程组发信号，Windows 用 `taskkill /PID <pid> /T /F`；
  任一平台失败都会抛出，不再被静默吞掉。
- `tc` shim：Windows 同时写 `bin/tc.cmd` 与 `bin/tc`，PATH 用 `path.delimiter` 拼接。
- 宿主工具：Windows 版 Claude Code 暴露的 shell 工具是 `PowerShell` 而不是 `Bash`，
  两者都会声明并加入 allowlist，否则 actor 没有任何命令执行能力。
- Pi SDK 宿主：按 `TASKCRAFT_EVAL_PI_SDK` 环境变量、`npm_config_prefix`、
  `PI_CODING_AGENT_DIR`、`~/.pi` 与当前 `node_modules` 顺序查找，未安装即明确报错。

## 三个案例

- `delivery`：空 fixture 起步，按公开 CSV 合同实现 `src/csv-summary.mjs`，用独立检查与 task fact 关闭 L1 任务。
- `recovery`：真实首会话开始执行；当 execute 尝试仍打开且源码已有实质变化时由控制器中断整棵进程树，再以全新会话从持久 tc 状态续做。
- `review`：控制器以真实来源植入带缺陷实现并预开 execute 尝试，新会话审查、修复并关闭既有尝试（缺陷不泄漏给 review 提示）。首版三个案例均使用 L1 记录；这个案例检验代码审查修复能力，尚不覆盖 L2 的 `tc review` 回流协议。

## 评分与聚合

`CheckResult`：`grader`（`code`/`model`）、`verdict`（`pass`/`fail`/`inconclusive`）、`reason`、可定位 `evidence`。

`HostRun` 与报告同时保留请求模型/thinking、实际响应 provider/model/API/providerThinkingLevel、usage 与 stop reason；请求条件和实际观测分开，失败响应不能被 system 文本或 worker 退出码单独伪装成成功。

- 独立 code grader 运行真实验收：直接执行产物对比合同（含 RFC 4180 引号、重复名称聚合、非法金额与 malformed row 拒绝），并读取 `tc task show` 的 execute 尝试、validation evidence 与必需 fact。
- model grader 在独立上下文、无工具（Claude 为 `--tools ""`，Pi SDK 为空工具 allowlist）、固定条目下做语义判断；输入含需求、code 检查结果、actor 最终文本与隔离 fixture 的实际文本产物（含 `src/` 与项目元数据），不执行被评材料里的指令。
- 本地校验要求：每个固定条目必须恰好出现一次、verdict 合法、reason/evidence 非空；不满足即整轮 `inconclusive`，不宽松兜底成通过。
- 聚合规则可解释：硬 code 失败为权威，model 判优或出错都不能覆盖；没有任何 actor 会话成功结束时视为“执行未建立”，空/半成品工作区记 `inconclusive` 而非产品功能失败；全部必要项通过才 `pass`。

## 恢复的诚实边界

只有控制器真正观察到“execute 尝试打开 + 源码已变化”，并确认首会话已被控制器中断，才会启动恢复会话并记录 `CheckpointEvidence.established=true`。未成立则 `recovery-checkpoint` 为 `inconclusive`。中断通过独立进程组的 `SIGTERM → SIGKILL` 完成；新会话不携带原始需求或任务 id，必须从工作区 README 和 tc 持久状态中找回工作。

## 校验

```bash
pnpm exec vitest run evals   # 目标测试（<60s）
pnpm typecheck:evals         # evals 类型检查（evals/tsconfig.json）
pnpm lint && pnpm format:check
```

测试覆盖：model 输出本地校验（缺条目/空证据/非法 verdict）、流解析与判定（success/error/invalid/timeout/interrupted）、聚合优先级与“未执行≠失败”、CSV 验收在已知正确实现上通过而在植入缺陷上失败、无检查点不得宣称已测。

## 添加案例

在 `cases/` 增加一个实现 `EvalCase` 的文件，并登记到 `cases/index.ts`；同时在 `board/guide.ts` 补齐背景、任务、步骤与验收标准说明。案例提供准备工作区、执行会话、代码验收和少数模型判断项，复用现有 runner 与 grader。给验收在 `tests/cases/` 添加一组正确实现和错误实现的测试，确保失败能被检出。`pnpm test` 和 `pnpm typecheck` 已包含 Evals；无需修改 Trellis。

## 范围与边界

- 仅 delivery/recovery/review；无 L3、无对照评分、无百分制。
- `runs/` 通过 `.gitignore` 忽略；报告不落凭据或整份环境变量。
- 真实宿主服务不可用时保留本次 `inconclusive`，不切换 provider 伪造通过；框架本身可交付与某次 tc 案例是否通过是两个结论。
