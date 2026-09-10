# 最小 Evals 设计

## 已确认扩展：独立浏览器看板

用户在概览/历史/对比/详情方案后明确选择独立 Evals 页面：evaluation harness 与 agent harness 无耦合。禁止导入 watch/、src/watch/ 或产品 Store；本次不修改产品 src/ 与 watch/。既有 runner 的 tc 公共命令使用保持原有被测边界，看板只读 JSON 报告。

### 页面与入口

- `pnpm eval --watch` 启动仅绑定 127.0.0.1 的轻量 Node HTTP 服务，打印可点击 URL；可提供端口参数以便开发/测试。不调用模型/不要求先构建 tc/不读 SQLite。CLI 原有 --case/--list 行为保持，可拒绝 --watch 与 --case 等互斥参数。
- 看板资源集中在 `evals/board/`：服务、数据转换、对比与场景说明在该目录，浏览器 HTML/CSS/JS 放 `public/`，看板单元/API/浏览器测试放 `tests/`，Playwright 配置放 `board/playwright.config.ts`。不引入独立前端包、框架或 npm runtime 依赖，不复用 tc Watch 实现。
- 桌面采用清晰、紧凑的浅色中文控制台布局：简短标题与最近更新时间，汇总数字（场景总数、已尝试、可判定/受阻），场景表（内容、最近时间、最新结果、较上次、耗时）。未测案例同样可见。
- 点开场景显示历史；选择一次运行显示一句话结论、条件、与上一次可比结果的逐项差异、检查结果，证据/诊断默认折叠。可以选择历史运行查看，无需找文件。移动视图可完整操作，键盘焦点与关闭详情行为明确。
- 读现有 JSON 数据、每隔数秒轮询刷新；不注入模拟历史到真实 runs/。旧记录缺字段继续显示，无法比较时明示，不伪造模型或版本。

### 数据与对比

- 一处纯数据模型转换服务于概览和详情。保留原始报告，不改写 legacy fail；已确认前置执行未成立的运行在可视层统一显示“执行受阻/未形成有效结果”，下游检查显示“无法判定：前置执行未完成”，原始观察可展开。不要把一条警告文字当作已确诊的根因。
- 报告加载有明确错误项，坏 JSON/缺字段不能悄悄消失或导致全页崩溃。HTTP 只暴露固定页面资产与受限报告查询，不提供任意本地路径读取，文本字段用 textContent/等价转义渲染。
- 对比同 case 的最近两个有效且条件一致的记录；页面也允许查看任意历史记录。pass/fail/inconclusive 的变化不做百分制。阻塞/无法判定不标为退步；没有基线、版本/模型条件不明、不一致时不直接下改善/退步判断。逐项新增/删除/不可判定检查不冒充通过/失败变化。
- 给今后的报告补充必要比较元数据：场景/验收与 grader 口径版本或指纹、实际 actor/judge 模型及可用宿主版本、运行预算。对比指纹不能包含被测 tc 的 Git revision，否则无法比较 tc 迭代；目标版本另存展示。未知实际模型不能用两个 null 相同来判条件一致。优先一个简短 provenance helper，不建立通用注册表。现有 schemaVersion v1 可作可选增量字段并向后兼容。
- 改动只服务于用户看板需求，不扩展调度器、批量测评、远程/账号/Web执行入口，不重复跑已知被阻塞的真实模型。

### 验证

- 数据与对比单测：历史旧格式、三个未测、现有受阻样本、功能失败、改善/退步/持平、不可比、损坏记录。
- 服务测试：真实 HTTP GET页面/API，严格路径范围，仅允许只读操作。
- 使用现有 Playwright 依赖新增 evals 独立配置/脚本做桌面和窄屏真实浏览器 smoke（不复用 smoke:watch）。覆盖点击详情、历史切换、折叠证据、刷新和不可比提示。合成报告只在测试临时目录，UI真实运行只展示真实 reports。
- 最后启动实际 `pnpm eval --watch`，请求真实页面/API并保留服务供用户查看；不将服务启动本身当 smoke。

## 原框架设计

用户已确认简化范围。本设计只具体化工程选择，不增加用例/评分系统。

## Layout and flow

正式实现集中于 `evals/`：根目录只保留 `cli.ts`、`tsconfig.json` 和 `README.md`；执行核心与共享类型放 `core/`，Claude/Pi SDK 宿主放 `hosts/`，共享模型评分和产物采集放 `graders/`，报告生成和指纹放 `reporting/`。`cases/` 保存三个场景与共享 CSV fixture/专属验收，框架测试统一放 `tests/`（案例测试放 `tests/cases/`）；看板与其测试仍在 `board/`，真实报告保留在忽略提交的 `runs/`。沿用现有 Vitest/typecheck/lint/format 和独立看板 Playwright 入口。

`pnpm eval --list` / `pnpm eval --case <id>`（精确 CLI 形式可按 Commander 约定实现）。运行时：临时工作区 -> 用当前 tc 公开 CLI 准备任务/执行 -> 收集产物及必要轨迹 -> 代码验收 -> 独立 judge -> JSON + Markdown 报告。临时工作区必须在本项目目录外，避免继承 Trellis/项目的 AGENTS；运行产物保存在 evals/runs，权限不宣称构成硬沙箱。

首版不需要复杂重放/基线比较子系统。保存必要证据和版本信息，便于诊断；不要持久化凭据或整份环境变量。

## Host

Claude Code print mode，spawn 的 shell=false，prompt 走 stdin。默认不覆盖现有模型路由；可提供显式 --model 和 --judge-model。独立会话无 resume/continue/fork，no-session-persistence。限制工具到本案例开发所需能力和显式公开 tc/test 命令；judge 不需要文件写入或 shell。禁止跳过权限/Hook trust；不修改个人配置。不静默使用 --safe-mode 或 --bare 绕过宿主能力。

当前本机 `claude --help` 已核实 `--output-format stream-json --verbose`、`--no-session-persistence`、`--json-schema`、`--strict-mcp-config`、`--disable-slash-commands`、`--permission-mode acceptEdits`。不要使用未在本机 help 中确认的隐藏 flag（例如 max-turns 未在当前 help 展示）；以外层超时提供明确运行预算。空 MCP 配置与关闭 slash commands 可用于缩小案例工具面，保留并披露用户设置/认证继承；不读取敏感设置正文。

官方文档经 context7-router 验证：`ctx7 library "Claude Code" ...` 选择 `/anthropics/claude-code`，`ctx7 docs` 来源包括 https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md 和 plugins/security-guidance/hooks/llm.py。stream-json 输出有最终 result，structured_output、usage、subtype；必须结合 exit code / is_error，不能单凭 subtype=success 判成功。--json-schema 需进行本地形状校验，格式错误是 inconclusive 而不是宽松兜底。

## Cases

- delivery：普通明确 CSV 需求，使用 tc 完成小任务，按产物和记录评分。
- recovery：真实首会话开始执行；在 tc execute 正运行且已有实质源码变更时，由控制器结束本次进程，然后以新会话从项目持久状态继续。优先在 tool completion 后检查，避免截断写入；若检查点未成立则不虚构。简单可靠实现优先，不依赖某段模型措辞。
- review：准备如实来源的带缺陷实现与 tc 执行事实，再让新会话审查修复。验收缺陷为公开 CSV 合同遗漏，不把缺陷位置或隐藏答案泄漏给 reviewer。

所有 Task Store 写入使用公开 tc 命令，必要查询通过公开 JSON 输出；独立行为验收不依赖 tc 只读投影自己宣称 done。Runner 可在准备数据时产生明确 controller fixture 来源，不伪称宿主 Agent 曾执行。

## Grading and reports

统一 CheckResult：id、grader(code/model)、verdict(pass/fail/inconclusive)、reason，模型项另含可定位 evidence。少数固定语义项：requirements/scope/honesty，不加权打分。代码验收与可证实的协议违反为硬判定；模型项为补充，明确失败不能被覆盖。API/格式错误不伪造模型通过。总体聚合必须可解释，所有必要项通过才 pass；硬失败为 fail；无法判定且无可靠失败为 inconclusive。

单独保存运行 phase 和中断事实，避免尚未实际执行的空 workspace 被记成产品功能失败。模型超时/服务错误保留简短诊断；Agent 正常结束但功能缺失则 fail。主报告包含案例结果、各 check、耗时/调用次数（如未知为 null）及环境版本。凭据、完整用户配置不进报告。

## Validation

在不调用付费模型的自动测试中覆盖判定、流式解析错误、timeout/进程控制、fixture 真/假样本与报告。真实 smoke 先一个 delivery，若服务通则按合理预算继续 recovery/review；若服务不可用，保留本次 inconclusive，禁止重复撞服务或换 provider 伪造通过。框架可交付与 tc 本身案例是否通过是两个结论。
