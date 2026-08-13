# Remediate Taskcraft MVP readiness and revalidate dogfood cutover

## Goal

复核并修复 Task 00–06 交付审查发现的产品合同缺口，使 Taskcraft 能通过公开 CLI
与真实 Codex/Claude 宿主完成诊断、等待恢复、Hook 接管与跨会话恢复闭环；同步
实现、测试、真实样本与权威文档后，重新判定 Trellis → Taskcraft 迁移门
pass 或 blocked。

## Background

- 来源需求是 `development/plans/task-07-mvp-readiness-remediation.md`
  （2026-08-13 交付审查发现，含 P0/P1/P2 三级缺口）。
- Task 00–06 实现与归档历史保留；归档 ≠ MVP 门通过。已知缺口：`tc doctor`
  未实现、waiting/resume/retry 无公开命令、codex Hook 未验证可用（advisory）、
  真实宿主 waiting/resume 样本缺失、L3 多 child 声明与图不一致、CLI 命令面
  与 cli.md 不一致、状态文档用词混用。
- Trellis 在 Task 07 完成前仍是唯一活动开发任务系统；不设双写。
- 用户已确认按文档执行拆分：父 + 6 子（A doctor / B waiting-resume-retry /
  C hook-rework / D runtime-diagnostics / E l3-children / F dogfood-docs）。

## Requirements

### REQ-01. tc doctor（A）

只读完整性检查：migration ledger/checksum、SQLite 外键、孤儿引用、事件序号
连续性、lifecycle definition digest、projector 重建一致性、breadcrumb Schema；
健康库退出 0；每类损坏返回稳定 `TC_STORE_*` 错误 + 非零退出 + **不修改数据库**；
`--json` 支持。

### REQ-02. Waiting/Resume/Retry 公开闭环（B）

`tc task wait` / `tc task resume` / `tc run retry` 公开命令 + attempt failure
进入 reducer 的公开路径；覆盖 `needs_input` / `needs_decision` /
`blocked_dependency` / `failed_retries_exhausted`；所有事实写入遵守事务、
事件与 revision/CAS 合同；真实 CLI 可完成 `active -> waiting -> active ->
done`，新进程/新宿主会话从同一 Task Store 恢复。

### REQ-03. Hook 安装与 test-hook 重做（C）

`tc agent test-hook` 必须测试**已安装的** `.taskcraft/hooks/entry.sh` /
`stop.sh` + 真实 Task Store + breadcrumb（不再测临时安装的拷贝）；codex
project trust / 用户级 feature gate / 一次性 Hook 审批未满足时**明确失败**；
已有宿主配置但未注册 Hook 不得返回成功（明确失败语义）；只有 Entry 注入、
Stop block 与 loop guard 均通过才声明 enforced。

### REQ-04. Runtime observation 与 Hook diagnostics（D）

`tc run attach` / `tc run status` 公开命令产生 `agent_runs`（真实命令，非
测试插库）；observation 的 finished 不直接把 Task 投影为 done（已有保证，
需公开路径复证）；Hook 现场测试的时间/宿主版本/结果/失败原因持久化；
Watch Runtime/Diagnostics 展示同一来源（product.md §5 要求）。

### REQ-05. L3 多 child 决策（E）

Plan 可声明多个 child 但生产图只有一个 execute-1 的合同偏差二选一：
(a) 真正物化 per-child execute/review 分支（校验 children /
validationOwners / childrenResults 一一对应，公开 CLI 生成真实双分支样本）；
或 (b) 明确收窄首版为单 execute，同步 lifecycle.md §5 合同并移除多分支
声称。产品决定先于实现；无论哪种，fixture 不能作为唯一证据。

### REQ-06. 真实宿主 dogfood 与文档收口（F）

公开 CLI 完成 L1/L2 创建、跨新会话恢复、waiting/resume、Review、done
样本（codex/claude 分别验证 Hook 安装与 Entry/Stop）；CLI 命令面收敛
（state/lifecycle/explain/task list/promote/revise/evidence/export/
--dry-run/--no-color/completion 逐项决定实现/延期标记/替代关系，`tc --help`
与 cli.md 一致）；状态文档同步（区分归档/实现/验收/真实宿主验证）；
最终迁移门复核给 pass 或 blocked。

## Acceptance Criteria

- [ ] `tc doctor` / `--json`：健康库退出 0；每类支持损坏稳定错误 + 非零退出 + 不改库。
- [ ] 真实 CLI `active -> waiting -> active -> done` + 新进程恢复；blocker 开/解有原子事件与 CAS 测试。
- [ ] `tc agent test-hook --agent codex|claude` 测已安装 hooks 与真实 breadcrumb；只有注入/拦截/loop guard 全过才 enforced。
- [ ] Hook 不可用/未注册/未批准明确阻断狗粮化，不以 advisory 成功替代失败。
- [ ] Watch Runtime/Diagnostics 数据由公开生产路径产生，不依赖 fixture 插库；observation 与 facts 分层。
- [ ] L3 多 child 声明与真实图一致（或明确收窄并同步合同）；保留时双 child 可公开 CLI 独立推进且 Review 全过前 Integrate blocked。
- [ ] cli.md 每个首版命令在 `tc --help` 可找到并有自动 smoke；延期命令在规范标记。
- [ ] `pnpm check` / `git diff --check` / `pnpm smoke:watch` 全过；保存真实宿主样本；迁移门结论明确。

## Child Task Map

| 子任务 | 交付物 | 依赖 |
| --- | --- | --- |
| `mvp-doctor` (A) | doctor 命令 + 损坏库测试 | 无（可并行） |
| `mvp-waiting-resume-retry` (B) | wait/resume/retry 命令 + blocker 生命周期 | 无（可并行） |
| `mvp-hook-rework` (C) | test-hook 真实链路 + 失败语义 | 无（可并行） |
| `mvp-runtime-diagnostics` (D) | run attach/status + Hook 结果持久化 + Watch 同源 | B、C 的结果合同 |
| `mvp-l3-children` (E) | 多 child 产品决定 + 实现或收窄 | 无（决定先于实现） |
| `mvp-dogfood-docs` (F) | 真实 dogfood 样本 + 命令面收敛 + 文档同步 + 迁移门结论 | A-D |

## Notes

- 每项审查发现先由执行 Agent 对当前代码复核；证据推翻原发现时记录反证。
- 禁止用 fixture/mock marker/help 文本替代公开生产路径与真实宿主行为。
- 本文件是源需求集；子任务在各自 prd/design/implement 细化。
