# Claude Entry 与 L2 跨会话恢复修复复测（2026-09-10）

Entry 检测和自然执行冷启动恢复通过，受控返工完成修复与独立审核。原测发现的
重复 Record 审计误报已另行修复，同一数据库只读复核通过。最终产品回归 **514 项通过**。
以下分别记录原始样本、控制器异常、Agent 使用瑕疵和诊断器后续修复，不合并成无缺陷样本。

## 范围与构建

本轮验证前次报告中已证实问题的修复，旧报告 [2026-09-09](claude-entry-l2-recovery-2026-09-09.md) 保留。仅评价当前构建、Claude Code 2.1.237、指定 `deepseek/deepseek-v4-flash` 与本 CSV 案例，不据此宣称跨模型稳定性或完成 Trellis 替代验收。

上述真实宿主会话构建 A 基于 Git HEAD `de04153b0dd24c393800433b3857ad86fd499909` 加本轮未提交源码。隔离版本重新编译 src、migrations 与 development/contracts；构建源码与工作区逐文件 SHA256 一致。源码哈希清单的规范化 JSON SHA256 为 `f249f1f41c553231b72da49bf9b132345e721cec6adc78996e474a4353fc6f17`。node_modules 复用本机依赖；不复制 Trellis 任务、修复说明或测评控制材料给被测。

修复内容：

- Claude Entry 启用 stream-json/verbose，仅成功 SessionStart 响应中的有效 breadcrumb 加成功模型终态可通过；模型复述不是注入证据。
- `task show` 返回与 `run` 同源的已领取 `nodeBrief`，恢复持久化 Review 关联和规范漂移；查询不写事实。
- 所有节点完成路径共享 revision 保存的结果 Schema，错误显示字段路径和约束，并给出具体任务的取卡命令；无部分写入。

## 自动验证

| 检查 | 结果 |
| --- | --- |
| Entry 定向回归 | 66 项通过 |
| 冷启动/结果格式定向回归 | 35 项通过 |
| 产品集成：`pnpm exec vitest run tests` | 73 文件、506 项通过，36.14 秒 |
| 产品 TypeScript、ESLint、Prettier | 通过 |
| 产品构建与隔离构建 | 通过 |
| Watch 桌面/移动真实页面冒烟 | 6 项通过，1.9 秒 |
| 独立代码审查 | 无阻断发现 |

Watch 首次被沙箱 `listen EPERM 127.0.0.1` 阻断，取得正常本机监听权限后通过，未改测试绕过。全仓 `pnpm typecheck` 的产品阶段通过，但随后用户并行开发的 `evals` 类型检查有错误；未修改该系统或其配置，不将全仓检查写为通过。

## 公共 Entry：pass

隔离项目通过公开 `init --agent claude`、`enable always`、`task new --level 1`、`run T-1` 建立唯一 active 根任务。仅项目和本次进程指定 DeepSeek；全局配置、上游与凭据未修改。

公共命令 `tc agent test-entry-hook --agent claude --json`，内部实际调用：

```text
claude -p --include-hook-events --output-format stream-json --verbose --setting-sources user,project "Reply exactly TC_FIRST."
```

提示词为产品默认值，不提供测评说明。公共命令保持 60 秒限时，仅启动一次真实宿主，使用正常宿主写入权限，不跳过全部工具权限。

- 耗时 **8.443 秒**、进程退出 **0**，返回 `ok=true`、`entryInjected=true`。
- `testedAt=2026-09-10T02:53:43.213Z`，版本 2.1.237，持久化 `entryHookTests.claude` 与公共结果一致。
- 公共 sample 可见 SessionStart hook_started、相同 hook_id 的 hook_response 和 Taskcraft breadcrumb 前缀，但按既有合同截断为 500 字符。没有独立保存完整内部 spawn 流；完整事件和终态由已审查、回归验证的解析器判断，不能把 sample 称为完整原始事件证据。
- 本次原生会话 `209ba1ff-9b8b-4403-8140-bd60aed9b673` 的模型与文本摘要独立确认 `deepseek/deepseek-v4-flash`、`TC_FIRST`，无工具调用。
- 宿主完全退出后验证 takeover off：wrapper 退出 0，stdout/stderr 均零字节；恢复 always 后输出完整任务摘要。

独立审查核对公共封套、持久化、原生模型摘要与 wrapper 结果一致。此次 Entry 检测不包含 Codex 实机样本。


## L2 隔离重测（2026-09-10）

操作员使用修复后独立运行构建 `/private/tmp/tc-repair-runtime-y3ymjln7/dist/cli.js`。本轮只操作临时被测项目与外部控制目录，未修改用户另行开发的 evals 系统。模型显式 `deepseek/deepseek-v4-flash`，每个新会话均从 init 事件核对实际模型；不 resume、continue 或 fork 会话，不传操作员历史，使用 `--no-session-persistence`。每会话上限 600 秒，最多六个有效开发/审核会话。

### 固定输入和隔离边界

初始需求沿用前次 CSV 公开需求：导出 exportTodosCsv(todos,{status="all"}={})；固定表头 id,title,completed,createdAt；all/open/done 筛选；createdAt 升序、同日期稳定顺序；逗号/双引号/CR/LF 字段加引号且双引号翻倍；LF 分行且无尾换行；空结果仅表头；不改变输入。固定外部验收覆盖这些公开要求，未增加隐藏行为要求。

初次提示完整内容：

> 请在这个项目实现待办列表 CSV 导出，并用 tc 管理为 L2 任务。新增 exportTodosCsv(todos, {status = "all"} = {})，从 src/todos.js 导出。输入 todo 字段为 id、title、completed、createdAt，createdAt 是 ISO 日期字符串；status 支持 all/open/done，open 仅未完成，done 仅完成。输出固定表头 id,title,completed,createdAt，行以 LF 分隔，末尾无换行；completed 输出 true/false。按 createdAt 升序排序，相同日期维持输入顺序；逗号、双引号、CR 或 LF 的字段用双引号包裹，字段内双引号加倍。空结果仅表头，不能修改输入数组或对象。请补测试并完成验证。

两次恢复均只有：

> 继续当前项目尚未完成的工作。

独立盲审均只有：

> 请独立审核本项目 tc 当前任务的执行产出。读取任务记录、需求和代码，运行测试并检查是否满足要求；通过 tc review 如实登记审核结论及证据。有问题则记录需要修改的具体问题，不要直接修改实现；无问题则通过审核。

最终复审提示：

> 请独立审核本项目 tc 当前任务的最新执行产出，检查需求、先前审核问题和当前实现，运行验证并通过 tc review 如实登记结论；如通过，请完成任务收尾记录。

被测项目只有正常 Node ESM 工程、基线 node:test、工程规范与简要 CLAUDE.md：源码/测试位置、npm test、正常 tc 绝对路径调用、工程规范应绑定。没有复制 Trellis、控制器、评分文件或旧聊天。`engineering.conventions` 通过 Git-owned `.taskcraft/spec/index.json` 登记并经公开 `spec check/list` 检查；首次建卡和 Frame 绑定由被测自行完成，实际卡包含 required/current 规范，不把 registry 单独存在算恢复成功。

工具参数：`--permission-mode acceptEdits --tools Read,Write,Edit,Bash,Glob,Grep`；允许 `Bash(node *)`、`Bash(npm test*)`、`Bash(git status*)`、`Bash(git diff*)`、`Bash(git log*)`、`Bash(ls *)`、`Bash(pwd)`、`Bash(cat *)` 和项目 Read；显式拒绝控制目录 Read/Grep/Glob。未 skip permissions、未中途放宽，不修改用户全局设置。实际仍加载个人 MCP（figma/contextweaver/google-devtools/exa）及宿主个人能力；shell 工具权限不是硬文件系统隔离，因此不宣称完全防泄漏沙箱。普通 Node 自写验证在本轮正常执行。

### 自然执行中断恢复

项目 `/private/tmp/todo-work-po5ugvpb`。

1. 首会话 `31dd17b3-8edb-4e96-81da-e3def2e6822f` 创建真实 L2 T-1，完成 Frame，绑定 required engineering.conventions，领取 Execute1；首次成功源码 Edit 后 74.287 秒停止，PID49018，143。控制条件同时核验源文件字节变化与数据库当前 revision 的已领取 Execute（created/resultJson=null），没有伪造 running。
2. 断点快照：taskRevision4、lifecycleRevision1、active；`att-T-1-execute-1-1` created、resultJson=null；Frame success。实现已通过固定 CSV 验收，但工程只有原始 1 条 listTodos 测试，实际工作尚未完成。首会话四条权限拒绝针对 runtime 外部搜索/枚举（含 grep/head/find/echo 多操作或跨工作目录路径）；CLI、项目源码读写未被阻断。
3. 冷会话 `e88ec940-751f-4d66-9a93-762c7548d238` 通过真实 SessionStart 获得 T-1、execute-1、revision4 和 detailCommand，首工具即 `task show T-1 --json`。返回包含完整 Node Brief、结果 schema、required/current 工程规范及持久 Frame。它识别“实现已存在，缺少CSV测试”，补5条测试，npm test 6/6与外部固定验收通过。
4. 冷会话先尝试 heredoc 写结果，被宿主 expansion-obfuscation 检查拒绝；再尝试 Write `/tmp/t1-result.json`，因项目外写入被拒绝。它自行使用项目内 Write 及公开 CLI 完成提交，没有控制器提示或额外授权。49.832秒、PID51365、143按断点停止；Execute1 finished/success、taskRevision5。提交的 Execute result 自带 `record`，因此同时生成 Record success；此时仍待审核，并非跳过审核直接 done。
5. 第三独立会话 `9e664653-7e55-45bb-bbd3-f3f6c12b457c` 读取记录/源码，npm test及自行编写的 Node 边界脚本验证，再通过 `review pass` 审核 Execute1。最终公开只读快照为 done/revision7。它没有单独运行 Record；Record 来自上一冷会话真实提交。其一条权限拒绝针对复合命令里的 `echo "EXIT=$?"`，其后改用合法方式继续。

第三会话原始 `result` 完整：is_error=false、terminal_reason=completed、duration_ms=50143。控制器已经读到自然 EOF，却在 finally 向已退出空进程组发 SIGTERM，macOS 返回 EPERM，导致 summary 生成异常。不得将其写为正常捕获的 OS exit0 或补造控制器耗时。原始事件完整、任务 done 快照和终态 result 支持此次业务结果；不存在前次那种解析崩溃后仍活动的日志缺口。该控制器自然结束清理分支已修正并增加合成测试，不重跑前三个样本、不隐去此干预。

### 受控返工起点

自然独立审核未发现返工，按预先批准方案另建项目 `/private/tmp/todo-work-35uxg8t8`，不继承自然项目数据库、测试或调试文件。控制器准备无字段转义的 CSV 候选；通过公共 CLI 建立 L2、完成 Frame 和 Execute1。提交证据如实声明“基线 listTodos 测试1条通过，尚不能证明CSV全部需求”，不冒充原 Agent 的真实产出。外部固定验收在此起点 exit1，证明真实缺陷存在。

准备期间操作员两次遗漏 --node：默认 run Execute 尚不可运行而失败，默认 complete Execute 校验 Frame 格式而失败，均明确无事实写入。纠正为 frame-1 后才完成初始化并启动被测；这些属于控制侧设置错误，不算被测失败。原始 setup 日志保留。

第四独立盲审 `9a1d73d8-b146-4bc1-b00c-a2644e03fdb0` 不知道缺陷位置或测评目的。它运行 npm test（基线1条）及普通 Node 探测，发现转义缺失和CSV测试不足，真实 `review changes` 登记 `fnd-T-1-1` 并创建 Execute2。38.803秒，PID54912，自然exit0，12工具调用、无权限拒绝；未改实现。新一轮 repair 从这个真实 changes checkpoint 开始，仅普通继续提示。

### 控制器验证

模型运行前4项合成测试通过：字符串/对象 message 与 permission_denied；坏 JSON 明确失败并保留终止尾日志；timeout；callback 异常及子进程组退出。真实第三会话发现自然结束空组 SIGTERM 错误后，增加自然 EOF/exit0 测试，五项均通过。每次精准处理本次创建的PID/进程组，不全局 pkill、不操作用户 evals 进程。

两种样本分别评价，受控缺陷成功不替代自然恢复；单次案例不证明稳定成功率或整体 Trellis 迁移门通过。

### 返工恢复与最终复审

第五会话 `b277a8b9-daac-43a6-a492-1be376c6acc4` Hook 成功注入 T-1/execute-1/revision7。首工具是 `task show T-1 --json | head -200`；它主动截断输出，实际返回里没有 `nodeBrief` 字段。因此本样本不能声称模型读取了新增完整执行卡，虽然控制侧原样详情快照证实该卡存在。它读取了摘要里的持久 finding/旧结果以及项目内 frame-result.json、execute-result.json、docs/conventions.md，完成实质转义修复和6条CSV测试；自行纠正测试中按物理换行拆分带引号LF的断言，未获得操作员提示。

repair 普通 Node 自写验证成功，npm test7/7，固定独立验收PASS。真实提交精确 Execute2，taskRevision8、active；Execute2与附带Record2均finished/success。62.882秒、PID55601、143按既定断点停止，20工具调用、无权限拒绝，无控制器异常。初始验证文件 validation-initial.txt 保留，新增 validation-csv.txt；未覆盖旧验证日志。项目内 execute-result.json 被后续修复覆盖，SQLite旧 Execute resultJson 仍保留。

第六且最后会话 `8e39c1c7-a79e-465b-afaa-631649698b8c` 是独立新会话。读取审核问题/最新执行结果与工程规范，独立运行 npm test7/7和自行编写的CSV边界脚本，真实通过审核 Execute2；最终done/revision10、next=null。没有源码改动。Record2来自上一repair的Execute附带结果，不是复审伪造新完成记录。

它随后自行运行 `tc doctor`，发现 `TC_SPEC_IMPACT_INVALID`，没有擅自修改数据库。控制侧结束后独立调用得到相同exit1：

```text
Invalid Spec Impact contract: T-1 att-T-1-record-1-2: missing satisfied Spec Impact obligation result
```

因此冻结本轮结论是：**返工定位、修复、提交与独立代码验收通过，任务达到done，但完整性诊断失败**。不将done扩大为全部健康，也不将这个诊断直接推定为数据库写坏；根因和后续产品修复另列，不覆盖本次原始样本。

该复审还自行披露一个CLI使用错误：把 `--finding @/private/tmp/todo-work-35uxg8t8/.review-finding.json` 当文件输入，而该选项为普通文本，造成 `fnd-T-1-2` summary 为字面路径。它是advisory且不阻断，不能把文件中的建议内容当作已经结构化入库，也不修数据库掩盖此瑕疵。

首次内联 `review pass` 因 shell 引号导致 `too many arguments` 失败，之后改用
`@evidence` 文件输入成功。这属于命令使用恢复，不是产品结果 Schema 的字段诊断实测。

final运行163.951秒、PID56653，自然exit0，36工具调用、4权限拒绝：heredoc引号混淆检查；项目外 `/private/tmp/probe_csv.mjs` 写入；诊断后对runtime外部grep复合命令；Grep读取runtime外目录。它自行在项目内写脚本并正常Node执行，不额外放权；runtime查源码拒绝影响进一步现场诊断，不影响此前通过的代码验证。完整终态与summary均捕获，无控制器错误。

### 六会话与结果矩阵

全部init.model均为 `deepseek/deepseek-v4-flash`，没有增加第七会话或重抽到通过。

| 场景 | 会话ID | 控制器秒数 | 结束方式 | 工具调用 | 权限拒绝 |
|---|---|---:|---|---:|---:|
| first | 31dd17b3-8edb-4e96-81da-e3def2e6822f | 74.287 | checkpoint/143 | 22 | 4 |
| cold | e88ec940-751f-4d66-9a93-762c7548d238 | 49.832 | checkpoint/143 | 13 | 2 |
| natural review | 9e664653-7e55-45bb-bbd3-f3f6c12b457c | 未形成；host result.duration_ms=50143 | 模型自然completed；清理EPERM，未捕获OS退出码summary | 17 | 1 |
| controlled review | 9a1d73d8-b146-4bc1-b00c-a2644e03fdb0 | 38.803 | natural/0 | 12 | 0 |
| repair | b277a8b9-daac-43a6-a492-1be376c6acc4 | 62.882 | checkpoint/143 | 20 | 0 |
| final review | 8e39c1c7-a79e-465b-afaa-631649698b8c | 163.951 | natural/0 | 36 | 4 |

| 样本 | 定位与阶段 | 已登记内容读取 | 实际工作与结果 | 最终诊断 |
|---|---|---|---|---|
| 自然执行中断冷启动 | pass：Hook T-1/Execute1 | pass：完整task show/Node Brief/schema/required-current spec | 补测试、真实提交、独立review pass；done/revision7；6/6与固定验收PASS | doctor healthy=true，11/11；自然review收尾控制器异常如上单列 |
| 受控审核返工冷启动 | pass：Hook T-1/Execute2 | pass：finding/旧结果/项目规范；未实际读到被head截掉的完整卡 | 实改转义、补测试、真实提交Execute2、独立复审pass；done/revision10；7/7与固定验收PASS | doctor exit1/TC_SPEC_IMPACT_INVALID；整体健康未通过 |

格式错误详细诊断没有在这两个有效恢复提交中由模型主动触发：它们都成功提交合法结果，因此不能把单元测试覆盖扩大为本轮模型端实测此错误分支。规范覆盖仅required/current工程规范读取；没有测漂移或缺文件恢复。

### 独立性、观察审计与资源

公开CLI最终读取与固定验收、npm test、doctor均已独立运行并保留exit/stdout/stderr。SQLite仅mode=ro查询：自然1条、受控2条review_links均为capability=context-only、independence_status=unverified、reviewer_principal_id=cli、observed_host_session_id=null；agent_runs均为空。会话分离由控制器和宿主session id证实，不能冒称Task Store记录了host-observed或observed-distinct。

完整逐行工具日志扫描：六个会话没有控制目录、验收脚本、Trellis任务资料路径的读取请求，也没有MCP实际调用。仍只说明本次观察未见控制材料读取；权限非硬沙箱、全局能力可见的限制保持。

精准ps核验49018/51365/53620/54912/55601/56653全部不存在（ps exit1，无输出）。原始运行日志、任务快照、只读事实、固定验收与源码摘要曾保留在外部控制目录供独立核验；核验后已按下节清理。未删除个人宿主历史/session-env，未改用户全局模型或项目evals。资源删除记录见下节。

## 追加修复：多次 Record 的 doctor 误报

这是六会话重测发现的既有审计缺陷。`satisfyObligation` 按 task/revision/node/obligation
唯一保存首次满足证据；`spec_impact_results` 则逐 Record attempt 保存。原 doctor
错误要求这条唯一义务分别指向 Record1 和 Record2，因此合法返工也会失败。只读事实
核验确认两次 Record 与 Impact 都已保存，未发生部分写入。

构建 B 仅在构建 A 上修改 `src/core/doctor-spec-impact.ts`：义务按节点/版本核验，
关联证据必须属于同任务、同版本、同 Record 节点的成功 attempt，并存在对应 Impact；
各 Record 的原始 result/Impact 校验继续逐次执行。没有更新义务去引用最后一次 Record，
也没有删旧记录或放过缺失 Impact。新增 8 个回归包含合法重复 Record、缺义务、错误
owner/node/revision、失败 Record、缺首次或第二次 Impact；相关 24 项定向测试通过。

构建 B 源码清单 SHA256：
`5fdf0f454a320781ee4726a8874a2e4a388ae86f26fe4e7ed165c063cc32736d`。

在原模型会话全部退出后，用 B 对**同一份未修改数据库**执行公开 `tc doctor --json`：

| 原始样本 | 构建 A 原测 | 构建 B 只读复核 | 数据库字节 |
| --- | --- | --- | --- |
| 自然样本 done/revision7 | 11/11，通过 | 11/11，通过，exit0 | 前后SHA256一致 |
| 受控返工 done/revision10 | Spec Impact诊断失败，exit1 | 11/11，通过，exit0 | 前后SHA256一致 |

这是诊断器修复的同库验证，不是另一次真实 Agent 生命周期重测；没有第七个模型会话。
原测 `doctor` 失败、控制器异常及 Agent 命令使用瑕疵仍按上文保留。

最终 B 构建验证：74 文件、514 项产品测试全部通过（90.83秒）；产品 TypeScript、
ESLint、Prettier 与构建通过。独立审查未发现阻断问题。最终变动只涉及 doctor，
此前桌面/移动 Watch 6 项通过，无新界面变动，未重复跑浏览器。

一次额外的共享工作区全回归出现90项失败：日志明确包含构建产物
`dist/cli.js` 在测试中短暂缺失，以及沙箱 `listen EPERM`。未改业务代码适配这些
环境失败；最终在源码/测试同源的独立 B 副本、正常本机监听权限下完成上述514项。

## 清理与交付

独立审查已核对原始事件、退出/断点、持久化事实、模型与提示、数据库哈希及本报告；
没有用受控样本替代自然样本或补造缺失退出码。核验后已按用户要求删除：

- 两个 CSV 临时项目及数据库、测试产出、调试文件。
- Entry 临时项目（删除前通过公开命令取消未完成 T-1）。
- 两份隔离 runtime 与控制目录、脚本、原始 stdout/stderr 和快照。

上述目录及定位文件均复查不存在；六个被测进程均已退出。未删除个人 Claude
宿主历史/session-env，未触碰用户另行运行的 evals 进程或其文件。保留修复源码、
回归测试、直接相关规范、本报告及 Trellis 任务/会话记录，未创建 Git commit。
原始临时日志已清理，今后可用本报告的精确输入与判据重新复测，但不能声称原始
日志仍可重新读取。最终结论仍仅适用于本模型、本构建和本案例。
