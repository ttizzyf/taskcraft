# 任务 07：MVP 就绪度返工与狗粮化门复核

> 状态：待执行（2026-08-13 交付审查发现）。Task 00–06 的实现和归档历史保留，
> 但在本任务验收通过前，不得据此宣称 MVP 发布门或 Trellis → Taskcraft
> 狗粮化进入条件已经满足。

## 目标

复核并修复 Task 00–06 交付审查中发现的产品合同缺口，使 Taskcraft 能通过公开
CLI 和真实 Codex/Claude 宿主完成完整的诊断、等待恢复、Hook 接管和跨会话恢复
闭环；同步实现、测试、真实样本与权威文档后，重新判定是否允许退出 Trellis。

## 返工判断

这不是三个孤立命令的局部补丁。缺口横跨 CLI、reducer、blocker、Adapter、Hook、
Runtime observation、Watch Diagnostics 和迁移门，且已经出现“fixture 可投影”被
误当成“生产路径可达”、“阶段任务已归档”被误当成“产品验收通过”的证据漂移。
本任务按结构性返工处理：每项能力必须有唯一事实写入口、公开命令、同源投影、
自动测试和适用的真实宿主证据，不增加第二套状态或隐藏 fallback。

## 依赖

- Task 00–06 的现有实现、合同、测试和交接材料保持可审计。
- Trellis 在本任务完成前仍是唯一活动开发任务系统，不得提前执行卸载或双写。
- 每项审查发现先由执行 Agent 对当前代码复核；若证据推翻原发现，必须记录反证，
  不能仅凭已有“已完成”状态关闭问题。

## 必读输入

- `development/specs/cli.md`
- `development/specs/lifecycle.md` 的连续执行、waiting 和 Review 回流章节
- `development/specs/architecture.md` 的 reducer/projector、Adapter 和 doctor 合同
- `development/specs/product.md` 的 Runtime、Diagnostics 和静默入口章节
- `development/runbooks/trellis-to-taskcraft.md`
- `development/host-smoke-2026-08.md`
- `development/task-02-handoff.md`
- `development/task-04-handoff.md`
- `development/task-05-06-handoff.md`

## 范围

### P0：狗粮化阻断项

1. **实现 `tc doctor`**：只读检查 migration ledger/checksum、SQLite 外键、孤儿
   引用、事件序号连续性、lifecycle definition digest、projector 重建一致性和
   breadcrumb Schema；健康库退出 0，损坏库返回稳定 `TC_STORE_*` 错误和非零退出。
2. **完成 waiting/resume/retry 公开闭环**：实现 `tc task wait`、
   `tc task resume`、`tc run retry`，并提供 attempt failure 进入 reducer 的公开
   路径；覆盖 `needs_input`、`needs_decision`、`blocked_dependency` 和
   `failed_retries_exhausted`，所有事实写入遵守事务、事件和 revision/CAS 合同。
3. **重做 Codex Hook 安装与现场测试**：`tc agent test-hook` 必须测试真实
   `.taskcraft/hooks/entry.sh`、`stop.sh`、Task Store 和 breadcrumb，不得用临时
   `echo` marker 代替产品链路；Codex project trust、用户级 feature gate 和一次性
   Hook 审批未满足时明确失败。已有宿主配置但未注册 Hook 不得返回成功。
4. **补真实宿主 dogfood 样本**：至少在一个真实宿主完成 L1/L2 创建、跨新会话
   恢复、waiting/resume、Review 和 done；Codex 与 Claude 分别验证 Hook 安装和
   Entry/Stop 行为。样本只允许使用公开 CLI，不得调用测试 helper 或直接写库。

### P1：产品合同缺口

5. **补齐 Runtime observation 命令链**：实现或明确替代 `tc run attach`、
   `tc run status` 和 stale/failed 后的 retry；真实命令产生 `agent_runs`，并证明
   observation 的 `finished` 不会直接把 Task 投影为 `done`。
6. **补齐 Hook/Runtime Diagnostics**：记录或可靠读取最近一次 Hook 现场测试的
   时间、宿主版本、结果和失败原因；诊断 Hook 文件/注册缺失、路径错误、未批准、
   timeout 和 adapter 版本漂移。Watch Runtime/Diagnostics 必须展示同一来源结果。
7. **复核 L3 多 child 语义**：当前 Plan 可声明多个 child，但生产图只有一个
   `execute-1`，双分支测试依赖预制 fixture。二选一并同步合同：真正物化独立
   execute/review 分支；或把首版明确收窄为单 execute，不再声称支持多分支执行。
   若保留多 child，必须校验 Plan children、validationOwners 和 Integrate
   childrenResults 一一对应，并通过公开 CLI 生成真实双分支样本。

### P2：规范与交付状态同步

8. **收敛首版 CLI 命令面**：逐项复核 `state`、`lifecycle`、`explain`、
   `task list/promote/revise/evidence/export`、`--dry-run`、`--no-color` 和 shell
   completion；迁移必需项在本任务实现，延期项在规范中明确标记，已被替代的命令
   删除并写明替代关系。`tc --help`、规范和示例命令必须一致。
9. **同步项目状态文档**：区分“阶段任务已归档”“实现完成”“验收通过”和“真实
   宿主已验证”；修正 README、roadmap、handoff、host smoke 与迁移手册之间的
   矛盾。fixture/纯函数测试不得标为真实宿主样本，Codex Hook 复验前保持
   `limited/advisory`。

## 交付物

- doctor、waiting/resume/retry、Runtime observation 和 Hook diagnostics 的生产实现。
- Codex/Claude Adapter 安装与真实 `test-hook` 链路，以及失败可操作诊断。
- 覆盖健康/损坏 Store、blocker 生命周期、retry exhaustion、Hook 失效和跨会话
  恢复的合同、reducer、CLI 与 Adapter 测试。
- 使用公开 CLI 生成的 L1/L2 waiting/resume、Review、done 和宿主恢复样本。
- L3 多 child 的明确产品决定、对应实现/删减及回归证据。
- 同步后的规范、路线图、README、handoff、真实宿主记录和迁移门结论。

## 验收标准

- `tc doctor` / `tc doctor --json` 对健康库退出 0；每类受支持的完整性损坏均返回
  稳定错误、非零退出且不修改数据库。
- 真实 CLI 可完成 `active -> waiting -> active -> done`，并在新的进程/宿主会话
  中从同一 Task Store 恢复；blocker 的打开和解决均有原子事件与 CAS 测试。
- `tc agent test-hook --agent codex|claude` 测试的是已安装的 Taskcraft Hook 和真实
  breadcrumb；只有 Entry 注入、Stop block 和 loop guard 均通过时才声明 enforced。
- Hook 不可用、未注册或未批准时明确阻断首版狗粮化，不以 advisory 成功替代失败。
- Watch Runtime 和 Diagnostics 的 host/run/Hook 数据由公开生产路径产生，不依赖
  fixture 或测试直接插库；observation 与 Task facts 保持分层。
- L3 多 child 声明与真实图一致；若保留该能力，两个 child 可由公开 CLI 独立推进
  并在全部 required Review 通过前阻止 Integrate。
- `development/specs/cli.md` 中每个首版命令都能在 `tc --help` 找到并有自动 smoke；
  延期命令不再伪装为已实现。
- `pnpm check`、`git diff --check`、`pnpm smoke:watch` 全部通过，且保存适用的真实
  Codex/Claude 样本；最终复核明确给出迁移门 `pass` 或带原因的 `blocked`。

## 非目标

- 不因补齐首版闭环引入云同步、账号系统、远程协作或自动模型选择。
- 不把 Watch Diagnostics 扩成第二个 doctor 或第二套状态推导。
- 不为追求命令数量机械实现已经明确延期的高级 CLI。
- 不在真实 Hook 和 waiting/resume 验收通过前卸载 Trellis。

## 验证

1. Contract/Schema、migration、doctor 损坏库测试。
2. blocker、failure、resume/retry reducer 与事务测试，单组后端测试硬超时 60 秒。
3. CLI 集成测试：命令存在性、CAS、稳定错误和真实 waiting/resume 闭环。
4. Codex/Claude Adapter conformance 与真实安装后 Hook smoke。
5. Runtime/Diagnostics API 与 Watch desktop/mobile smoke。
6. 全新临时目录中的 L1/L2 dogfood，以及全新宿主会话恢复样本。
7. 规范、CLI help、README、roadmap、handoff 和迁移 runbook 交叉一致性检查。

## 执行拆分与顺序

建议建立一个父任务并按可独立验收边界拆分：A=`doctor`，B=`waiting/resume/retry`，
C=`Hook 安装与 test-hook`，D=`Runtime/Diagnostics`，E=`L3 多 child 决策`，
F=`真实宿主 dogfood 与文档收口`。A/B/C 可并行；D 依赖 B/C 的结果合同；F 依赖
A–D。E 可并行，但产品决定必须先于对应实现。父任务负责跨层数据流、CLI/Watch
一致性和最终迁移门复核。

## 后续启动提示

任务标题：`Remediate Taskcraft MVP readiness and revalidate dogfood cutover`

执行 Agent 不要从“Task 00–06 已完成”倒推问题已经解决。先按本文件逐项复现，
保存命令与证据，再决定修复或以反证关闭；禁止用 fixture、mock marker 或 help 文本
替代公开生产路径和真实宿主行为。全部验收完成后，才重新执行
`development/runbooks/trellis-to-taskcraft.md` 的进入条件。
