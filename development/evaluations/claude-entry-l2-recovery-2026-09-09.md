# Claude Entry 与 L2 冷启动恢复测评报告

> ⚠️ **已被后续证据更新。** 本报告中「公共 `test-entry-hook` fail」是 2026-09-09 当日
> 构建的结果。该可观测性问题随后修复：2026-09-10 复测已通过，2026-09-26 又在 Windows
> 本机由 Claude 2.1.177 与 Codex 0.155.1 双双通过。当前结论见
> [`../entry-hook-smoke-2026-09-26.md`](../entry-hook-smoke-2026-09-26.md)。

日期：2026-09-09。首轮使用原配置模型遭遇429；用户随后明确指定 `deepseek/deepseek-v4-flash`，本报告以第二轮实测为最新结论，首轮原记录保留于附录。

## 最新结论

| 测项 | 第二轮结果 | 证据与边界 |
| --- | --- | --- |
| DeepSeek 模型调用与真实 Entry Hook | pass | 指定模型正常完成，流式事件包含Hook success和完整任务摘要 |
| 公共 `test-entry-hook` | fail：检测可观测性缺陷 | 宿主成功退出，但tc因普通文本stdout没有breadcrumb退出1；公共参数未启用Hook事件要求的stream-json |
| 执行中断后首次冷启动 | 部分观察，不能完整评分 | 补测试并通过代码验收，未登记；控制器解析异常与未捕获窗口污染后续观察 |
| 执行中断补充冷启动 | 未完成闭环 | 读到任务/需求，代码验收通过，但600秒内未成功取得结果格式并提交；权限限制和不同起点是混淆因素 |
| 审核返工后冷启动 | 受控前提下 pass | 独立盲审真实changes → 新会话读取finding并修复 → 独立复审pass → Record → done |

这里没有测得通用成功率。通过的返工样本以人工准备的不完整实现为起点，不是首个执行Agent自然产出的缺陷；两种冷启动结果不能拼接成一次整体通过。当前仍不宣称Trellis迁移门已经通过。

## 环境与冻结协议

- Git `de04153b0dd24c393800433b3857ad86fd499909`；Node 24.8.0、pnpm 10.33.0、Claude Code 2.1.237。宿主为Claude Code，后端为用户指定DeepSeek，服务地址与个人全局配置未改。
- 第二轮随机临时根目录 `<root>` 为 `/private/tmp/tc-session-5yvm6nud`。runtime从当前源码独立构建成功；116份src文件与启动基线逐一SHA256匹配。只读使用本机已有node_modules，不把Trellis、历史会话或本报告放进被测项目。
- 两条测试并行；L2初始项目与受控返工项目为独立兄弟目录。六个开发/审核会话均显式`--model deepseek/deepseek-v4-flash`、`--no-session-persistence`，不resume/continue/fork，不传操作员历史。
- 控制器和评分材料位于项目外；需求与判据在会话前确定。冷启动提示仅“继续当前项目尚未完成的工作。”，未提示测评目的或恢复答案。五项观察为定位、阶段识别、持久化内容读取、真实工作、正确结果提交与独立验收，见结果矩阵。
- L2权限与首轮相同：acceptEdits，内置Read/Write/Edit/Bash/Glob/Grep；允许tc公共CLI、npm test、node --test及项目Read，明确拒绝control目录的Read/Grep/Glob。没有skip permissions或中途放宽。全局MCP/技能仍可见，shell也不是完整文件系统隔离，不能声称硬沙箱。
- 普通自写node脚本被宿主权限拒绝是此测评工具配置的混淆因素；reviewer后来自行使用npm test完成验证。部分会话枚举父目录、读取runtime源码，但未观察到读取评分材料或Trellis测评说明。
- 执行切换条件为真实领取execute且首次源码Edit成功、未提交结果。未attach宿主时tc attempt为created，控制器按真实领取证据识别，未伪造running状态。返工切换条件为真实review changes创建第二次execute。
- 只写报告和必要Trellis记录；不修tc产品、不修改迁移标准，不操作用户并行evals系统。

## A：第二轮 DeepSeek Claude Entry 检测

结论：指定模型正常可用，真实 Hook 事件与模型响应都已观察成功；但原样公共检测失败，原因是成功宿主输出中缺少 breadcrumb。这次已从首轮环境阻塞收敛为公共检测的可观测性缺陷实证，不能把诊断通过替代公共通过。

### 前提

本轮全新临时项目，通过当前独立构建 `tc init --agent claude`、`tc enable always`、`tc task new --level 1`、`tc run T-1` 成功建立唯一 active 根任务。节点 execute-1，taskRevision 2，lifecycleRevision 1。产品源码/运行构建不改；无全局配置修改。

用户指定 `deepseek/deepseek-v4-flash`（同一上游）。先仅临时 `.claude/settings.json` 设置 model；发现全局 ANTHROPIC_MODEL 覆盖，随后仅临时项目 env.ANTHROPIC_MODEL 和本次公共进程 ANTHROPIC_MODEL 指定该名称。直接诊断显式 --model。未读写凭据值、未切换服务地址。

### 命令与结果

公共 CLI：`node <runtime>/dist/cli.js agent test-entry-hook --agent claude --json`。
实际子进程参数保持源码原样：`claude -p --include-hook-events --setting-sources user,project "Reply exactly TC_FIRST."`，产品60秒限制不改。

| 样本 | 实际模型 | 耗时 | 结果 |
|---|---|---:|---|
| 仅项目 model 的公共调用 | gemini（配置覆盖未生效） | 5.054s | exit 1，host exited 1；本次生成的宿主日志有429 cooling down，不计为指定模型样本 |
| 独立流式诊断，--model指定 | deepseek/deepseek-v4-flash | 7.286s | exit 0，Hook success，result TC_FIRST，is_error=false |
| 纠正临时 env 后的公共调用 | deepseek/deepseek-v4-flash | 4.306s | tc exit 1，TC_ADAPTER_HOOK_TEST_FAILED，`entry injection: tc-breadcrumb/v1 missing from host output` |

最后一个错误分支只在宿主 `ok=true` 时产生，因此宿主成功退出而公共观测失败。本次原生宿主日志会话 `36acff22-a47f-40de-ab5a-ccc4676270ce` 的 assistant.model 是指定 DeepSeek，文本为 `TC_FIRST.`；仅提取本项目新建日志的模型及文本，不读取用户其他项目历史。

流式诊断完整参数：`claude -p --include-hook-events --setting-sources user,project --output-format stream-json --verbose --no-session-persistence --tools "" --model deepseek/deepseek-v4-flash "Reply exactly TC_FIRST."`，外层60秒timeout。
诊断会话 `967dcd0e-35e5-44dc-9838-afca0f95e770`：init.model=deepseek/deepseek-v4-flash；SessionStart hook_response exit_code=0/outcome=success；stdout含 `Taskcraft Entry context:` 和 tc-breadcrumb/v1、T-1、active、execute-1、next=`tc run complete T-1`、detailCommand=`tc task show T-1 --json`。最终 result=TC_FIRST。这是独立诊断会话，不声称取得了公共那一会话的流式事件。

### 根因证据

Claude --help 明确 `--include-hook-events` 仅与 `--output-format=stream-json` 一起生效；tc 的 Claude adapter 当前只给 include-hook-events，没有 stream-json。检测器又依赖成功宿主 stdout 包含 tc-breadcrumb/v1。因此即使模型正常完成，它在普通文本输出模式下也不输出Hook事件，公共检测会失败；本次公共失败与独立流式成功吻合。未修改源码或伪造事件。

### 其他检查及限制

无宿主运行时检查 wrapper：off 退出0且stdout/stderr均0字节；always退出0且输出正确breadcrumb。之后保持always，供主会话最终取消任务、清理。

共3次宿主启动，第一轮项目model覆盖错误如实保留。全部采用已批准正常宿主权限，因为首轮已证实默认沙箱EPERM；未跳过Claude权限。直接诊断禁用内置工具但全局MCP仍加载；实际无工具调用，plugins=[]，有正常个人skills和自动记忆路径。Entry本身的固定测试提示属于公开产品检测，不是L2盲测提示。

诊断stderr仍有unrecognized_model警告，但本次DeepSeek已成功响应，不能把该警告等同请求失败。模型按其输出解释为TC_FIRST或TC_FIRST.；公共检测判定并不检查这个精确字符串，只检查breadcrumb。

A 检测进程已结束；取证时T-1仍active，最终资源处理见第二轮清理记录。首轮报告保留在附录。

## DeepSeek L2 恢复测评操作报告（已完成）

用户授权本轮所有被测会话显式选择 deepseek/deepseek-v4-flash；保持上游与个人配置不变。所有控制材料在项目外，被测仅见正常开发说明与公开需求。

执行中断前提已建立：首个会话 0326a80f-3c2f-474b-81c3-f77abc922a2d 创建 T-1 L2，完成 frame-1、领取 execute-1，成功 Edit src/todos.js 后由控制器停止（PID12133，89.26 秒，退出143）。此时测试仅基线1条，execute结果为空。tc 未attach宿主时 attempt为created，不能称running；run领取有工具输出证据。外部检查器修正对这一实际状态的识别，记录l2-first-checkpoint-*；没有改数据库或改变中断条件本义。

冷启动使用新会话 6944fe71-d8e9-42ff-9d2c-9e2d5aea6371，仅普通提示“继续当前项目尚未完成的工作。”；Hook实测成功注入T-1、execute-1、taskRevision4、next=tc run complete T-1及detailCommand。未传旧对话、未resume或continue。


### 首个冷启动的限制

冷启动1读取了源码和工程规范、执行基线测试，并新增5个功能测试；npm test 6/6通过，控制侧独立验收通过。捕获日志确认它调用 `task show T-1 --json` 并成功收到 revision4、execute attempt1 created/result null，以及 frame 的完整 resultJson；未观察到重新领取 Node Brief。它尝试用heredoc构造结果并complete，被Claude以“Contains brace with quote character (expansion obfuscation)”拒绝，尚未到tc校验。

该permission_denied系统事件的message为字符串，控制器错误地按对象解析导致AttributeError。精确停止PID13305前出现未捕获活动窗口；存在result-T-1.json/probe.js/inspect-db.mjs等遗留调试文件。inspect-db.mjs明确readOnly:true。停止后tc taskRevision仍4、execute结果为空；这只能证明当前状态和未观察到事实提交，不能证明窗口内绝无数据库操作。该样本为部分观察/控制器干预，不能判完整pass或将未收口归因tc。

控制器已修复字符串消息解析，并为后续进程加finally终止进程组。冷启动2仍只收到普通继续提示，但起点已有6条测试及上述调试文件，必须作为补充样本单列。它首先task show --json读取持久化frame；自行构造错误结果JSON，被tc返回TC_LIFECYCLE_RESULT_INVALID、无事实写入。随后它尝试只读SQLite/运行源码probe，多次被宿主权限拒绝；这些不是tc提供了执行卡。最终未成功取回输出Schema并提交，详见补充样本最终结果。


### 独立受控返工起点

另建独立兄弟目录l2-rework，无原项目数据库或调试文件继承。控制器按原公开需求准备真实CSV候选实现，但遗漏字段转义；通过公开tc init/enable/task new/run/frame complete/run/execute complete建立T-1待审。记录如实说明人工准备，不冒充前Agent产物；原基线npm test 1/1只覆盖listTodos，证据明确不能证明CSV全需求。控制侧固定独立验收在此起点退出1。

第4会话为真实独立盲审，不知道具体缺陷或测评目的，只收到正常审核要求。它读取任务、需求、源码；node自写脚本被Claude许可拒绝，随后自行写test目录并npm test，真实复现缺转义。权限条件维持不变，没有额外补批/跳过；这部分限制和模型自行找到合法验证路径分别记录。

Reviewer一度写了“含LF字段split换行后只能2行”的错误断言，合法CSV带引号LF也会有多条物理行；这项不能用来证明实现缺陷。逗号、双引号、CR独立失败真实成立。控制器未给提示或修改测试，让后续修复者与复审自行处理。


### 返工恢复已观察结果

盲审真实提交changes_requested，fnd-T-1-1、review attempt1 finished/changes_requested，taskRevision8产生execute attempt2 created。全新repair仅普通继续提示；Hook成功注入revision8，首工具task show --json，读取findings、frame与旧execute结果，再读取源码/验证资料。它实际修复escapeCsvField并补测试，自行纠正新增测试中的物理换行计数错误，移除临时审核测试，npm test 8/8通过。公开run complete成功提交execute attempt2，控制器按预设边界停止（86.8秒，143），交给第6会话独立复审。固定控制侧验收通过。

在这个人工缺陷前提下，返工定位、阶段识别、读取持久化内容、实质修复、真实提交与独立控制验收五项均观察到；随后独立复审与完成记录均成功，最终为done。这个结果不能证明前Agent会自然产生相同缺陷，也不能替代第一种执行中断恢复的完整通过。

证据路径局限：repair覆盖了docs/validation.txt（旧execute也引用它且无digest）；两次输出确实分别为1/1和8/8，但文件引用自身不保证历史不可变。控制侧setup日志保留了初始验证事实。

权限局限：本机个人设置仍加载MCP、个人技能与自定义agents，没有关闭或改写用户配置；allowedTools不是硬安全沙箱。受测曾枚举随机父目录和读取runtime打包源码，未观察到读取control评分/本Trellis任务资料。全程无测评目的提示传入。node自写脚本的许可拒绝是控制条件造成的混淆因素，不是tc功能缺陷。


### 执行中断补充样本最终结果

cold2（8ede9ca0-8b98-46c8-ad73-da3c1954573b）运行601.03秒达到600秒控制上限后被SIGTERM停止，exit143。最终taskRevision4，execute attempt1仍created/result null。它正确定位并读取持久化frame与源码、运行测试，但构造结果多次被TC_LIFECYCLE_RESULT_INVALID拒绝，未成功取回输出Schema并提交。代码仍通过独立验收。应评价为这个有控制器遗留产物/权限混淆条件的补充样本未完成收口，不能将其推导为所有Agent都无法恢复，也不等于已确定tc硬性阻断。

### 提示词与会话数

本轮共6个被测/审核会话，不追加抽样直到成功；全部显式 --model deepseek/deepseek-v4-flash、--no-session-persistence，未resume/continue/fork旧聊天。执行冷启动和返工冷启动提示均完全相同：“继续当前项目尚未完成的工作。”。

初次普通需求：

> 请在这个项目实现待办列表 CSV 导出，并用 tc 管理为 L2 任务。新增 exportTodosCsv(todos, {status = "all"} = {})，从 src/todos.js 导出。输入 todo 字段为 id、title、completed、createdAt，createdAt 是 ISO 日期字符串；status 支持 all/open/done，open 仅未完成，done 仅完成。输出固定表头 id,title,completed,createdAt，行以 LF 分隔，末尾无换行；completed 输出 true/false。按 createdAt 升序排序，相同日期维持输入顺序；逗号、双引号、CR 或 LF 的字段用双引号包裹，字段内双引号加倍。空结果仅表头，不能修改输入数组或对象。请补测试并完成验证。

独立盲审提示：

> 请独立审核本项目 tc 当前任务的执行产出。读取任务记录、需求和代码，运行测试并检查是否满足要求；通过 tc review 如实登记审核结论及证据。有问题则记录需要修改的具体问题，不要直接修改实现；无问题则通过审核。

最终复审提示：

> 请独立审核本项目 tc 当前任务的最新执行产出，检查需求、先前审核问题和当前实现，运行验证并通过 tc review 如实登记结论；如通过，请完成任务收尾记录。


### 最终独立复审与收口

第6会话独立复审完成，168.74秒自然退出0；它读取旧finding与新execute产出，运行独立5项验收测试，自行修正了一处相同日期稳定排序测试的预期顺序错误后5/5通过；未改源码。随后真实review pass审核execute attempt2，领取record-1获取结果合同并提交specImpact none，任务最终done、taskRevision13、next=null。控制侧收尾npm test 8/8通过，固定独立验收PASS，tc doctor healthy=true、11项检查通过。运行中的Spec Registry为空，未测规范绑定恢复。

### 最终结果矩阵

| 样本 | 定位 | 阶段 | 持久内容 | 实质工作 | 真实提交+独立验收 | 总体 |
|---|---|---|---|---|---|---|
| 首次执行中断后的cold1 | 已见Hook定位 | 已见execute | task show/frame已读；也读源码/规范 | 补5测试，代码验收通过 | 未完成；控制器异常及日志缺口 | 部分观察，不判完整通过 |
| 补充cold2（不同起点） | 通过 | 通过 | task show/frame已读 | 验证现有实现，独立验收通过 | 600秒内未成功提交 | 此样本未闭环，受权限/控制遗留条件影响 |
| 人工缺陷后的返工冷启动 | 通过 | 通过 | task show/finding/旧产出已读 | 修复转义并补测试 | execute2真实完成、控制验收PASS | 受控前提下通过；独立复审后done |

这是一轮六会话、两个项目的探索测评，不是成功率测量；不能把不同cold样本合并成一次pass，也不能凭受控返工成功宣称整体迁移门通过。

### 进程与交付

已通过精准ps检查六个PID 12133/13305/14662/16951/19406/20678全部不存在（ps退出1、无匹配）。不再启动新样本。临时资源的最终处理见第二轮清理记录；用户全局历史/会话环境目录不由本操作员删除。没有修改产品代码，没有碰用户另行运行的evals系统。


### tc 独立性声明与最终状态

主会话要求核验后，控制器使用SQLite mode=ro只读查询review_links与agent_runs（没有写事实）。实际reviewer、repair、final会话ID互不相同并无历史传递；但tc记录的两条review_links均为capability=context-only、independence_status=unverified、reviewer_principal_id=cli、observed_host_session_id=null；agent_runs为空。因此“真实会话分离”是控制侧证据，不能冒称数据库已验证observed-distinct。

原l2项目最终T-1 active/revision4/next=tc run complete T-1；受控l2-rework项目最终T-1 done/revision13/next=null。原l2没有review_links；rework两次delivery分别绑定execute1和execute2。

## 第二轮会话清单

| 角色 | 会话ID | 秒 | 退出 | 捕获工具调用数 |
| --- | --- | ---: | --- | ---: |
| first | `0326a80f-3c2f-474b-81c3-f77abc922a2d` | 89.26 | 143 | 18 |
| cold | `6944fe71-d8e9-42ff-9d2c-9e2d5aea6371` | 未完整采集 | 控制器异常后外部停止 | 17 |
| cold2 | `8ede9ca0-8b98-46c8-ad73-da3c1954573b` | 601.03 | 143 | 64 |
| rework-review | `957d4d30-7334-4395-a761-c5e83619dcb3` | 267.15 | 0 | 40 |
| rework-repair | `4ed94f7d-830b-40ba-93d9-465f49fc5a41` | 86.8 | 143 | 21 |
| rework-final | `b06d606d-b2ea-4c2d-a757-024c6f9e0c02` | 168.74 | 0 | 38 |

工具调用计数仅代表捕获日志中的tool_use事件，不保证全执行成功；cold1存在日志缺口。143是控制器中断，不代表模型自然退出或tc错误。

## 审核独立性与最终事实

受控返工的reviewer、repair、final-review实际是三个不同的新Claude会话。但Task Store两条Review link均为 `capability=context-only`、`independence_status=unverified`、`reviewer_principal_id=cli`、`observed_host_session_id=null`。所以只能说本次控制器观察到独立会话，不能声称tc已记录host-observed独立性证明。

```json
{"project":"l2-rework","taskId":"T-1","taskRevision":13,"status":"done","next":null}
```

初审审核 `att-T-1-execute-1-1` 并记录真实changes；修复写入 `att-T-1-execute-1-2`；最终审核该第二次执行并通过。项目测试8/8、控制侧冻结验收PASS，最后doctor healthy=true、11项检查通过。Spec Registry为空，因此本轮未验证Spec绑定/漂移在恢复中的行为。

第一项目取证终态仍为T-1 revision4、execute attempt1 created/result null。后续清理取消该未完成任务，不将其标为done。

## 可行动发现

1. **已复现的检测缺陷**：Claude公共检测依赖stdout中出现breadcrumb，但没有启用stream-json；模型正常返回仍判失败。证据包括源码参数、Claude帮助、原样公共失败和独立流式成功；未将诊断变体当作公共通过。
2. **需要改进或进一步隔离验证的恢复入口**：中断后next直接给complete，补充样本未发现可以重新通过run取得执行卡，转向猜JSON/读数据库，最终未收口。现有run路径并非不存在；此观察不证明不可恢复，权限限制、模型选择和控制器遗留文件也有影响。
3. **已成功的受控路径**：已有审核finding与旧execute结果时，新会话能读取、修复并登记，另一新会话完成独立复审与Record。它证明一个真实受控案例可行，不代表所有中断/任务等级都可靠。
4. **证据引用限制**：验证文件被后续会话覆盖而旧evidence仍指向同一路径且无摘要；本轮控制日志保留了旧内容，但路径引用本身不等于不可变历史。这不表示SQLite事实被覆盖。

## 第二轮清理与报告复核

- 独立报告审查已对照原始事件、task快照、源码、冻结验收及会话摘要完成，纠正了cold1确实读取task show/frame的早期日志摘要错误；没有修改产品代码。
- 两个未完成的临时任务均经公共CLI取消：Entry项目T-1 → cancelled/revision3；执行中断项目T-1 → cancelled/revision5。受控返工项目保留测评终态done/revision13直到删除数据库，不伪造其他任务完成。
- 操作员逐一核查本次六个L2 PID已不存在，Entry进程均已结束；未用全局pkill或操作用户evals进程。
- 已删除第二轮随机临时根目录和定位文件，含三个被测项目、源码构建副本、数据库、控制器、验收脚本与原始日志，并确认路径不存在。首轮临时目录此前已清理。
- 删除前116份runtime源码和本轮启动时11个tracked dirty文件的SHA256均与基线一致；其中用户原有9项改动未变。后续仅写入本报告及必要Trellis任务/日志记录，不改全局模型配置，不删除宿主个人原生日志/session-env。
- `git diff --check`通过。没有产品修改，因此没有重复跑完整产品套件；本轮的独立构建、被测项目真实测试、冻结验收和doctor结果已分别记录。任务归档不代表所有测项通过。未提交Git。


## 附录：首轮原配置模型记录

下面保留首轮环境阻塞记录；其未覆盖结论仅适用于首轮，不替代上面的第二轮结果。

### Claude Entry 与 L2 冷启动恢复测评报告

日期：2026-09-09（Asia/Shanghai）。本报告记录实际尝试及未覆盖项，不声明完整迁移验收通过。

#### 结论

| 测项 | 结果 | 证据边界 |
| --- | --- | --- |
| 本地 Entry gate：active 输出、off 静默 | pass | 仅脚本/数据库链路，不代表模型已消费 |
| 真实 Claude SessionStart 调用项目 Hook | pass | 正常宿主权限下观察到 success/exit 0 和完整 breadcrumb |
| 公共 test-entry-hook 命令 | blocked（实际退出 1） | 原样沙箱超时；权限重跑仍非零；未取得公共成功记录 |
| L2 执行中断后恢复 | not-exercised | 模型服务阻塞，未创建任务、未进入 Execute |
| L2 审核返工后恢复 | not-exercised | 同上，未建立 Review changes 检查点 |

正常宿主权限的流式诊断及 L2 会话观察到当前模型路由的 `429 RESOURCE_EXHAUSTED`，提示模型凭据全部 cooling down；公开命令本身只留下超时或非零退出证据，不能把每次失败都确定归因于 429。不能据此认定 tc 恢复能力有缺陷，也不能将 Hook 输出成功扩大为 Agent 已正确恢复。没有成功的 L2 被测样本，恢复五项评分均为 N/A。

#### 环境、范围与证据留存

- Git：`de04153b0dd24c393800433b3857ad86fd499909`；Node `v24.8.0`；pnpm `10.33.0`；Claude Code `2.1.237`。
- 登录探测显示已登录；实际会话模型为 `gemini-3.8-flash-high[1m]`，沿用个人配置，没有指定其他模型。宿主是 Claude Code，不代表后端模型是 Anthropic Claude。
- 仓库外临时根目录 `<root>` 为 `/private/tmp/tc-session-52vpgc6y`，包含 runtime、entry、l2、control。当前源码独立 TypeScript 构建成功（exit 0），不使用仓库已有 dist；依赖通过只读使用现有 node_modules 链接解析。构建副本不含 Trellis 和会话历史。
- 取证复核确认 runtime 的 116 份 `src/` 文件均与启动基线 SHA256 一致。按路径排序，将每条写为 `路径<TAB>文件SHA256<LF>` 后得到源码摘要清单 SHA256：`db7890d9442c0f626dd9faa3be88802400ffec0e8d85e9a317a5b695d926f2df`；该摘要范围仅为 `src/`，不包含依赖和数据库 migration。
- 两个操作员并行；被测 Claude 是独立进程，未继承操作员对话。用户另行运行的 evals 系统未被操作；并发请求对限流的影响未知。
- 预先建立 PRD、design、implement 和验收程序，模型启动后未改动评分标准。测评目的和控制材料未注入被测提示；个人 MCP/技能仍可见，因此不是硬安全沙箱。
- 按用户要求仅保留本报告中的脱敏关键证据及必要 Trellis 管理记录，临时代码/数据库/原始日志清理。原始证据不长期保留意味着后续不能重新解析完整事件流；下面摘要与会话标识保留本次观察依据。

#### A：Claude Entry 现场检测

结论：公共检测未通过；真实 Claude SessionStart 已成功调用项目 Hook 并输出完整 breadcrumb，但模型请求受到环境阻塞，不能判完整现场通过。未修改产品实现或全局配置。

##### 前提与命令

临时项目通过当前构建的公开 CLI 依次执行 `init --agent claude --json`、`enable always --json`、`task new --title "Prepare project README" --level 1 --reason "Local documentation task" --json`、`run T-1 --json`，均退出 0。唯一根任务 T-1 为 active，node=execute-1，taskRevision=2，lifecycleRevision=1。注册只有项目 `.claude/settings.json` SessionStart -> bash `.taskcraft/hooks/entry.sh`。

公共命令：`node <runtime>/dist/cli.js agent test-entry-hook --agent claude --json`。实际 adapter 子进程：`claude -p --include-hook-events --setting-sources user,project "Reply exactly TC_FIRST."`，产品原有 60000ms 超时不变。

流式诊断：`claude -p --include-hook-events --setting-sources user,project --output-format stream-json --verbose --no-session-persistence --tools "" "Reply exactly TC_FIRST."`。独立外层 60s timeout；该命令不是公共测试通过替代品。`--tools ""` 禁用内置工具，但 init 仍加载全局 MCP 工具；实际没有 assistant 工具调用。

##### 实际结果

| 样本 | 执行环境 | 时长 | 退出/结果 |
|---|---|---:|---|
| 公共原样首次 | Codex 默认沙箱 | 60.535s | exit 1，TC_ADAPTER_HOOK_TEST_FAILED，timed out after 60000ms |
| 流式诊断首次 | 默认沙箱 | 60.025s | 外层超时；Hook exit 1，EPERM mkdir ~/.claude/session-env/<session>；API unknown retry |
| 流式诊断纠正样本 | 精准提权，正常宿主权限 | 60.025s | Hook success exit 0，stdout 含 tc-breadcrumb/v1；API 429 rate_limit 重试；外层超时，无模型完成 |
| 公共原样环境重跑 | 精准提权，正常宿主权限 | 51.564s | exit 1，host exited with code 1；stderr unrecognized_model，模型名 gemini-3.8-flash-high[1m] |

成功 Hook 会话 `4ebb9306-c651-4944-84d0-e66618698593` 的 hook_response 明确包含 `Taskcraft Entry context:`、T-1、active、execute-1、`tc run complete T-1` 与 `tc task show T-1 --json`。能证明宿主成功运行和暴露 Hook 输出，不能证明模型已经理解或消费这些内容。

用户 model 别名为 opus，真实 init model 为 `gemini-3.8-flash-high[1m]`；未覆盖模型选择。stderr 出现 `[claude-code:unrecognized_model]`，与诊断中 429 分开记录，不能仅凭警告认定代理不支持此模型。

##### 静态检查与控制干预

直接运行 wrapper：active 时退出0并输出正确 breadcrumb；`enable off` 后 wrapper 退出0、stdout=0 bytes、stderr=0 bytes；随后恢复 always。off 检查发生在第一轮流式诊断仍存活期间，故该轮缺失 breadcrumb 不可独立归为产品失败。该轮明确的 EPERM 仍是有效环境错误证据。纠正样本全过程 always，未再变配置。

当前 Claude --help 明确 `--include-hook-events` 仅适用于 `--output-format=stream-json`；公共 adapter 没传 stream-json。此为可观测性配置疑点，但由于本次公共样本未成功退出，不能声称已复现单独由此造成的 false negative。

正常宿主权限重跑由用户已授权真实 Claude 启动及明确沙箱 EPERM 支持，未使用 skip-permissions。两次提权已获自动审核许可。

##### 环境与限制

Claude Code 2.1.237；用户 settings 没有 hooks 或 enabledPlugins；实际 init plugins=[]，但加载个人 skills、agents、MCP 与自动记忆路径。未读取或写入个人凭据值，未修改全局配置。公开 Entry prompt 本身是产品检测提示，不是开发能力盲测。

两次公开命令、两次诊断共4个宿主启动，所有结果如实保留，不是重复抽样直到成功。公共与流式提权样本有短暂并发；429不能归因于特定来源，用户并行评测及其他流量情况未知。只读 wrapper/off 检查不能代替现场模型完成。宿主可能创建个人原生日志/session-env；不删除用户宿主历史。

A 操作员已结束检测进程；取证时 T-1 仍为 active。最终资源处理见本报告清理记录。


#### B：L2 冷启动测评

结论：模型服务 blocked，执行中断恢复与审核返工恢复均 not-exercised。没有 tc 任务被创建，没有被测代码修改，不能对 tc 恢复能力评分。

##### 固定协议与输入

使用当前隔离构建的 tc；项目为无依赖 Node ESM 待办工具，公开 src/todos.js、node:test 基线、docs/conventions.md 工程规范、正常 CLAUDE.md（仅目录/测试/CLI 使用方式）。控制侧在首个会话前固定验收程序与普通需求：

> 请在这个项目实现待办列表 CSV 导出，并用 tc 管理为 L2 任务。新增 exportTodosCsv(todos, {status = "all"} = {})，从 src/todos.js 导出。输入 todo 字段为 id、title、completed、createdAt，createdAt 是 ISO 日期字符串；status 支持 all/open/done，open 仅未完成，done 仅完成。输出固定表头 id,title,completed,createdAt，行以 LF 分隔，末尾无换行；completed 输出 true/false。按 createdAt 升序排序，相同日期维持输入顺序；逗号、双引号、CR 或 LF 的字段用双引号包裹，字段内双引号加倍。空结果仅表头，不能修改输入数组或对象。请补测试并完成验证。

验收覆盖空表头、all/open/done、日期升序与同日期稳定顺序、逗号/双引号/LF/CR 转义、冻结数组对象不变；没有加入未公开的验收项。执行中断条件为 tc 中 execute running 且首次实质源码写入成功、尚未 complete；返工条件为真实独立审核 changes_requested。两个检查点均未触发，未创建人工缺陷样本，因为模型在任何任务动作前已被阻断。

##### 实际运行

- first：会话 `db007985-c260-4e90-9f36-a216163e96d3`，42.82 秒，退出 143，tool use 0。
- first-retry：会话 `c5187f14-d762-4851-8f40-7f77e9ec9566`，53.52 秒，退出 143，tool use 0。
- cold：会话 `0c3035ec-0282-4027-9a90-a9f7ed3b3edc`，21.08 秒，退出 1，tool use 0。

1. first 在受限沙箱中运行；SessionStart mkdir ~/.claude/session-env 被 EPERM 拒绝，API 多次 unknown 重试。仅停止本次记录的进程组。
2. first-retry 是唯一有依据的提权环境重试，没有修改模型或配置、没有跳过 Claude 权限检查；SessionStart 成功，输出为空（此时没有活动任务）。API 返回 `429 rate_limit`，可见 retry_delay_ms 为 579、1036、31000；这些是客户端重试延迟，不是已证实的 HTTP Retry-After。停止重试，未把它算产品失败。
3. cold 为真实无历史新会话，仅提示“继续当前项目尚未完成的工作。”，没有 resume/continue/fork 或旧对话传递。因为无任务可恢复，它只是额外连通性探测，不是有效恢复样本。SessionStart 成功、输出为空。最终实际退出 1，result 虽有 subtype=success，但 is_error=true、terminal_reason=api_error、api_error_status=429，必须判失败而非成功。

cold 的脱敏模型错误：

```text
API Error: Request rejected (429) · All credentials for model gemini-3.8-flash-high are cooling down via provider antigravity
last error: code=429, message="Resource has been exhausted (e.g. check quota).", status="RESOURCE_EXHAUSTED"
```

实际宿主 Claude Code 2.1.237，model init 为 `gemini-3.8-flash-high[1m]`，不是 Anthropic Claude 模型；默认配置未改。错误由当前模型路由/antigravity 提供方报告，不能归因于 tc 或用户 Claude 订阅本身。

##### 评分

| 场景 | 定位 | 阶段 | 持久内容 | 实质推进 | 登记与验证 |
|---|---|---|---|---|---|
| 执行中断冷启动 | not-exercised | not-exercised | not-exercised | not-exercised | not-exercised |
| 审核返工冷启动 | not-exercised | not-exercised | not-exercised | not-exercised | not-exercised |

基线 npm test：1/1 通过。独立新功能验收：退出 1，`TypeError: f is not a function`，因为 exportTodosCsv 从未实现；这是基线缺少待开发功能的预期现象，不是恢复后的回归。tc task list 输出 data.tasks=[]。src/todos.js SHA256 始终为 `f5028578f0ea9e39bad8318b80527fceea4927f9acbcd6807079bf060f659087`。

##### 隔离与局限

- 所有被测会话使用 --no-session-persistence、--output-format stream-json、--verbose、--include-hook-events、permission-mode acceptEdits，未使用 skip permissions/bare/safe-mode，也未强制切换模型。
- 环境只实际发现并删除 CODEX_THREAD_ID；TRELLIS_* 不存在。未将测评 PRD、design、评分程序或主会话历史送给被测模型。
- 工具 allowlist 限定 tc CLI、npm test、node --test 和项目 Read；controller Read/Grep/Glob 显式拒绝。保留用户既有全局配置；init 中有 4 个 MCP（figma/contextweaver/google-devtools/exa），个人技能及自定义 agents，没有 plugins。故不是硬安全隔离，MCP 和全局能力仍可见，需要如实保留此局限。全程没有任何工具调用发生，没有观察到控制材料读取。
- auto-memory 路径指向本随机临时项目；未单独审计所有全局记忆内容，但没有用户聊天历史传递。no-session-persistence 不保证宿主不创建自身环境目录，未删除全局宿主资料。
- 本次只操作明确记录的 PID/进程组，没有 pkill；未触碰用户另行运行的 evals 系统。

没有生产代码修改。最终资源处理见本报告清理记录。

进程收尾核验：仅查询本次记录 PID 7411、8933、8535，ps 返回 1 且无匹配输出，三个 Claude 进程均已退出。


#### L2 命令与冷启动输入

三个独立会话使用同一工具/输出配置，工作目录为 `<root>/l2`，其中 `<prompt>` 首轮是上文完整开发需求，最后一轮仅为 `继续当前项目尚未完成的工作。`：

```text
claude -p <prompt>
  --output-format stream-json --verbose --include-hook-events
  --no-session-persistence --permission-mode acceptEdits
  --tools Read,Write,Edit,Bash,Glob,Grep
  --allowedTools "Bash(node <root>/runtime/dist/cli.js *)" "Bash(npm test*)"
                 "Bash(node --test*)" "Read(<root>/l2/**)"
  --disallowedTools "Read(<root>/control/**)" "Grep(<root>/control/**)"
                    "Glob(<root>/control/**)"
```

这些 allow/deny 规则并不构成完整文件系统或 MCP 隔离；本次没有任何模型工具调用，未观察到控制材料泄漏，也没有足够行为数据检验隔离强度。冷启动时任务列表为空，所以该启动不能冒充执行中断后的恢复。

#### 脱敏原始事件摘录

正常宿主权限 Entry 流式诊断：

```json
{"subtype":"hook_response","exit_code":0,"outcome":"success","session_id":"4ebb9306-c651-4944-84d0-e66618698593"}
```

上述事件 stdout：

```text
Taskcraft Entry context:
{"schemaVersion":"tc-breadcrumb/v1","takeover":"active","task":{"id":"T-1","level":1,"status":"active","taskRevision":2,"lifecycleRevision":1,"waitingReason":null,"node":"execute-1","nodeKind":"execute"},"blocked":[],"next":{"command":"tc run complete T-1"},"detailCommand":"tc task show T-1 --json"}
```

同会话随后出现：

```json
{"subtype":"api_retry","error_status":429,"error":"rate_limit"}
```

L2 最终会话终态关键字段为 `is_error=true`、`terminal_reason=api_error`、`api_error_status=429`；即使事件 `subtype=success`，也未按成功计分。

#### 后续判断

当前必须先让本机现有模型路由恢复可用，再原样重跑公共检测与两个有效 L2 检查点；本轮没有修改模型配置、tc 实现或迁移要求。公共检测参数缺少 stream-json 是独立待复核项，不能用它解释尚未成功退出的所有失败。两个恢复场景没有评分，迁移门保持未通过。

#### 清理与仓库完整性

- 已独立交叉核验原始事件、提示词、参数、退出码、模型错误与结论；未修改产品实现，未运行与纯报告无关的完整产品测试套件。
- 临时 A 任务经公共 `task cancel T-1` 成功取消：`ok=true`、`taskRevision=3`、`status=cancelled`；L2 没有创建任务。
- 操作员确认本次检测进程已结束；B 三个记录的进程 PID 均已核查不存在。未用全局 pkill 或停止用户其他进程。
- 已删除本次临时根目录及定位文件，包含代码副本、独立验收脚本、Task Store、控制日志和原始事件；删除后验证路径不存在。宿主可能生成的个人原生日志/session-env 未删除，也未修改用户原有配置。
- 原有 9 个未提交文件逐一 SHA-256 对比均未变化；runtime 的 116 份源码与隔离构建基线一致。
- 本次只交付本报告和必要 Trellis 管理记录，未提交 Git。`git diff --check` 通过。

