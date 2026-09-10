# Journal - wangjie (Part 1)

> AI development session journal
> Started: 2026-08-07

---



## Session 1: Bootstrap Taskcraft Trellis spec indexes

**Date**: 2026-08-07
**Task**: Bootstrap Taskcraft Trellis spec indexes
**Branch**: `main`

### Summary

Bound and completed 00-bootstrap-guidelines; added a canonical Taskcraft source index, reduced backend/frontend specs to evidence-based entry points, removed placeholder templates, validated discovery and links, and left product Task 00 untouched.

### Git Commits

| Hash | Message |
|------|---------|
| `276565a` | (see git log) |

### Status

[OK] **Completed**


## Session 2: Task 00 host probes and decisions

**Date**: 2026-08-10
**Task**: Task 00 host probes and decisions
**Branch**: `main`

### Summary

Verified Codex, Claude, and SQLite behavior; accepted eight simplified ADRs; removed unnecessary authorization, capability-evidence, dispatch, and probe-runner designs.

### Git Commits

| Hash | Message |
|------|---------|
| `a3780ca` | (see git log) |

### Status

[OK] **Completed**


## Session 3: Freeze Taskcraft runtime contracts

**Date**: 2026-08-10
**Task**: Freeze Taskcraft runtime contracts
**Branch**: `main`

### Summary

Applied the approved minimal activation, review, host, structured-result, interruption, storage, and planning contracts; validated SQL and JSON schemas; archived the second Task 00 child.

### Git Commits

| Hash | Message |
|------|---------|
| `cc0efcf` | (see git log) |

### Status

[OK] **Completed**


## Session 4: Finalize Taskcraft repository contract baseline

**Date**: 2026-08-10
**Task**: Finalize Taskcraft repository contract baseline
**Branch**: `main`

### Summary

Added ADR navigation, clarified document authority and Task 01 engineering inputs, synchronized the parent acceptance rules, and recorded full contract/link validation evidence.

### Git Commits

| Hash | Message |
|------|---------|
| `18e25a8` | (see git log) |

### Status

[OK] **Completed**


## Session 5: Complete Task 00 contract baseline

**Date**: 2026-08-10
**Task**: Complete Task 00 contract baseline
**Branch**: `main`

### Summary

Completed the parent integration review, marked Task 00 complete in repository documentation and roadmap, verified all contracts and links, and archived the full three-child Trellis task tree.

### Git Commits

| Hash | Message |
|------|---------|
| `d7bd36c` | (see git log) |

### Status

[OK] **Completed**


## Session 6: Build Taskcraft engineering foundation

**Date**: 2026-08-11
**Task**: Build Taskcraft engineering foundation
**Branch**: `main`

### Summary

Implemented the Node/TypeScript engineering foundation: single-package ESM toolchain (Node 24, pnpm 10, TypeScript 6 strict, Vitest 4, ESLint 10 + typescript-eslint 8, Prettier 3), Commander 15 tc CLI shell, better-sqlite3 connection policy and applyMigrations runner with schema_migrations ledger, and Ajv 2020 strict contract validators for Lifecycle/Breadcrumb. Toolchain decisions: @eslint/js pinned to 10.0.1 (mirror limit); ajv named import for CJS interop; esModuleInterop enabled; pnpm.onlyBuiltDependencies for better-sqlite3 native build.

### Main Changes

- Established pnpm/ESLint/Prettier/Vitest toolchain with 400-line max-lines policy
- Added openDatabase connection policy and applyMigrations runner with TC_STORE_* error codes
- Added Ajv 2020 strict validators for Lifecycle and Breadcrumb contracts
- Added Commander 15 tc root CLI shell with package.json version source

### Git Commits

| Hash | Message |
|------|---------|
| `cc499f1` | (see git log) |
| `ff76ea9` | (see git log) |
| `f59120c` | (see git log) |
| `d4ee87f` | (see git log) |
| `99ac4f2` | (see git log) |
| `b2c562a` | (see git log) |

### Testing

- [OK] pnpm check (17 tests, typecheck, lint, format, build) all pass
- [OK] pnpm install --frozen-lockfile reproducible; CLI smoke passes

### Status

[OK] **Completed**

### Next Steps

- Task 02 can directly import Store/migration/Schema helpers


## Session 7: Task 02 L1 纵切：store-transaction 子任务

**Date**: 2026-08-11
**Task**: Task 02 L1 纵切：store-transaction 子任务
**Branch**: `main`

### Summary

规划 Task 02（父+3子），完成并归档 store-transaction：withTransaction、revision CAS 守卫、只读 query model，14 个新测试，trellis-check 通过

### Git Commits

| Hash | Message |
|------|---------|
| `1b5428d` | (see git log) |

### Status

[OK] **Completed**


## Session 8: Task 02 L1 纵切：reducer-projector 子任务

**Date**: 2026-08-11
**Task**: Task 02 L1 纵切：reducer-projector 子任务
**Branch**: `main`

### Summary

实现并归档 reducer-projector：L1 内置图、单 reducer（taskNew/run/runComplete/cancel+失败语义）、单 projector（五状态）、command-result/breadcrumb、7 个 fixtures、47 个新测试；发现并裁决 record obligation 与 storage.sql trigger 的冲突（物化 record attempt），trellis-check 修复 4 处问题

### Git Commits

| Hash | Message |
|------|---------|
| `b6e1f08` | (see git log) |
| `0915e0a` | (see git log) |

### Status

[OK] **Completed**


## Session 9: Task 02 L1 纵切：l1-cli-smoke 子任务

**Date**: 2026-08-11
**Task**: Task 02 L1 纵切：l1-cli-smoke 子任务
**Branch**: `main`

### Summary

实现并归档 l1-cli-smoke：8+ 命令面、Node Brief、同源 text/JSON 渲染、26 个 CLI 集成测试、真实 smoke 到 done；trellis-check 裁决 --facts 回 core 持久化与 record 补交闭环（run/run-complete 按节点分支）

### Git Commits

| Hash | Message |
|------|---------|
| `1921755` | (see git log) |
| `384c41e` | (see git log) |
| `1c91b48` | (see git log) |

### Status

[OK] **Completed**


## Session 10: Task 02 父任务：集成验收与归档

**Date**: 2026-08-11
**Task**: Task 02 父任务：集成验收与归档
**Branch**: `main`

### Summary

父任务 Phase D 集成验收：临时目录端到端 smoke 全通过（主闭环/cancel/CAS/level 拒绝/record 补交/stdin），AC 逐条核对满足，冻结文件无改动；更新 task-02-handoff.md 与 roadmap 状态，父任务归档

### Git Commits

| Hash | Message |
|------|---------|
| `d6dc614` | (see git log) |

### Status

[OK] **Completed**


## Session 11: Task 03：review-reducer 子任务

**Date**: 2026-08-12
**Task**: Task 03：review-reducer 子任务
**Branch**: `main`

### Summary

实现并归档 review-reducer：L2 图、review start/pass/changes/replan 四命令、revision 切换与 supersede、projector review next、6 个 fixtures、49 测试；trellis-check 核验 3 个语义决策并修复 run 可 claim review 节点崩溃缺陷

### Git Commits

| Hash | Message |
|------|---------|
| `fae87c5` | (see git log) |
| `4f27011` | (see git log) |
| `d44904d` | (see git log) |

### Status

[OK] **Completed**


## Session 12: Task 03：review-cli 子任务

**Date**: 2026-08-12
**Task**: Task 03：review-cli 子任务
**Branch**: `main`

### Summary

实现并归档 review-cli：tc review 四命令、L2 三路径闭环（passed/changes/replan）真实 smoke、可回放样本 l2-review-sample.md、9 个 CLI 测试；修复跨 revision attempt id 撞车与 obligation 重复满足 UNIQUE 冲突（含 writeRecordResult 编号遗漏）

### Git Commits

| Hash | Message |
|------|---------|
| `5faa9d5` | (see git log) |
| `6c8cd75` | (see git log) |
| `c2d536a` | (see git log) |

### Status

[OK] **Completed**


## Session 13: Task 03 父任务：集成验收与归档

**Date**: 2026-08-12
**Task**: Task 03 父任务：集成验收与归档
**Branch**: `main`

### Summary

父任务集成验收：L2 三路径（passed/changes/replan）真实 smoke 全过、AC 逐条满足、历史（superseded/finding/revision）可查询；写 task-03-handoff.md、roadmap 状态更新、父任务归档

### Git Commits

| Hash | Message |
|------|---------|
| `bb0c8f2` | docs: add Task 03 handoff and update roadmap |

### Status

[OK] **Completed**


## Session 14: Task 04：adapter-core 子任务

**Date**: 2026-08-12
**Task**: Task 04：adapter-core 子任务
**Branch**: `main`

### Summary

实现并归档 adapter-core：HostAdapter 接口、codex/claude 实现（capabilities 永不 crash、testHook 60s 超时、installEntry 幂等）、Node Brief 同源渲染、conformance 14 断言×2 宿主、43 测试

### Git Commits

| Hash | Message |
|------|---------|
| `ba9c2da` | feat(adapters): add host adapter interface and codex/claude implementations |
| `75ddc2f` | test(adapters): cover adapter conformance and failure paths |

### Status

[OK] **Completed**


## Session 15: Task 04：hook-wiring 子任务

**Date**: 2026-08-12
**Task**: Task 04：hook-wiring 子任务
**Branch**: `main`

### Summary

实现并归档 hook-wiring：静默入口 gate（off/ask/always 矩阵）、Entry/Stop Hook 安装（项目级配置、write-if-absent 幂等）、tc init --agent/enable/agent 命令、TC_ADAPTER_* diagnostics、52 新测试；trellis-check 修复 3 处（enable 显示 bug、重复定义、工作区残留清理）

### Git Commits

| Hash | Message |
|------|---------|
| `fb99d59` | (see git log) |
| `d43da99` | (see git log) |

### Status

[OK] **Completed**


## Session 16: Task 04：host-smoke 子任务

**Date**: 2026-08-12
**Task**: Task 04：host-smoke 子任务
**Branch**: `main`

### Summary

真实宿主 smoke：codex S1 零注入 verified、S2 limited（exec 不加载项目配置）；claude S3 零注入 + S4 注入/Stop/loop-guard verified（enforced）；发现并修复 resolveTcPath 层级错误与 stop_hook_active 防自循环缺失；smoke 记录文档落库

### Git Commits

| Hash | Message |
|------|---------|
| `1f704c4` | (see git log) |
| `4cb42bc` | (see git log) |

### Status

[OK] **Completed**


## Session 17: Task 04 父任务：集成验收与归档

**Date**: 2026-08-12
**Task**: Task 04 父任务：集成验收与归档
**Branch**: `main`

### Summary

父任务集成验收：AC 逐条满足（零注入/唯一 next/enforced-advisory 披露/diagnostics/全局配置零改动）；写 task-04-handoff.md、roadmap 更新、父任务归档

### Git Commits

| Hash | Message |
|------|---------|
| `8d91b23` | docs: add Task 04 handoff and update roadmap |

### Status

[OK] **Completed**


## Session 18: Task 05：L3 graph-reducer + cli-sample 子任务

**Date**: 2026-08-12
**Task**: Task 05：L3 graph-reducer + cli-sample 子任务
**Branch**: `main`

### Summary

实现并归档 l3-graph-reducer（L3 图/feasibility gate 不可绕过/taskFactAdd/8 fixtures/23 测试）与 l3-cli-sample（fact add 命令/L3 主闭环+回流/可回放样本/7 测试）；两个 trellis-check 均通过

### Git Commits

| Hash | Message |
|------|---------|
| `522b3e2` | (see git log) |
| `135866b` | (see git log) |
| `80fdc52` | (see git log) |

### Status

[OK] **Completed**


## Session 19: Task 05/06 父任务：集成验收与归档

**Date**: 2026-08-13
**Task**: Task 05/06 父任务：集成验收与归档
**Branch**: `main`

### Summary

L3 主路径（feasibility gate/on-demand integration/9-9 obligations）与 Watch（四 API/深链/405）真实 smoke 通过；roadmap 全部完成；写 task-05-06-handoff.md（指向迁移 runbook）；两个父任务归档

### Git Commits

| Hash | Message |
|------|---------|
| `3fb0214` | (see git log) |
| `228deb3` | (see git log) |
| `9b3ac2e` | (see git log) |
| `b3c304e` | (see git log) |
| `aeacfd4` | (see git log) |
| `aa7eed3` | (see git log) |

### Status

[OK] **Completed**


## Session 20: Task 07：MVP 就绪度返工（父 + 6 子）

**Date**: 2026-08-13
**Task**: Task 07：MVP 就绪度返工（父 + 6 子）
**Branch**: `main`

### Summary

Task 07 全部完成并归档：tc doctor（7 项只读检查）、waiting/resume/retry 公开闭环（双进程 smoke）、test-hook 真实链路（失败语义化）、run attach/status + hookTests 持久化同源、L3 收窄单 execute、state/task list 命令与 CLI 收敛；真实宿主 dogfood（claude 3 次验证：active 注入/waiting 静默/跨会话恢复）；迁移门复核 blocked（codex 未复验 + L2 真实样本缺失）

### Git Commits

| Hash | Message |
|------|---------|
| `8f8a9a3` | (see git log) |
| `196b195` | (see git log) |
| `fc25abc` | (see git log) |
| `e6eed98` | (see git log) |
| `e87f2cb` | (see git log) |
| `66fe90d` | (see git log) |
| `955c872` | (see git log) |
| `f325f06` | (see git log) |

### Status

[OK] **Completed**


## Session 21: Remove Stop Hook and adopt agent-driven continuation

**Date**: 2026-08-14
**Task**: Remove Stop Hook and adopt agent-driven continuation
**Branch**: `main`

### Summary

Removed Codex/Claude Stop Hook and forced continuation; adopted Entry-only recovery, agent-driven progress, typed waiting, Entry-specific field tests/diagnostics, and synchronized product/Trellis specs.

### Git Commits

| Hash | Message |
|------|---------|
| `babeb09` | (see git log) |
| `b70adb5` | (see git log) |

### Status

[OK] **Completed**


## Session 22: Complete modular L3 task decomposition

**Date**: 2026-08-17
**Task**: Complete modular L3 task decomposition
**Branch**: `main`

### Summary

Implemented one-level L1/L2 modular L3 tasks with inherited planning, explicit dependencies, replan/reuse, parent integration, CLI/Watch/doctor coverage, and verified Codex Entry registration. pnpm check passed 54 files/396 tests and Watch smoke passed 6/6; Claude Entry remains pending and Stop Hook remains removed.

### Git Commits

| Hash | Message |
|------|---------|
| `914b048` | (see git log) |
| `f4ff255` | (see git log) |
| `8c8726b` | (see git log) |

### Status

[OK] **Completed**


## Session 23: Complete Taskcraft Spec system

**Date**: 2026-08-24
**Task**: Complete Taskcraft Spec system
**Branch**: `main`

### Summary

Implemented and independently verified the Git-owned Spec Registry, revision-scoped lifecycle bindings, Node/Review Brief delivery, typed Spec Impact, doctor diagnostics and Watch views; archived all three child tasks and the parent after full CLI, migration, compatibility and desktop/mobile validation.

### Git Commits

| Hash | Message |
|------|---------|
| `ddec2a7` | (see git log) |
| `7fe84e5` | (see git log) |
| `1f2167e` | (see git log) |

### Status

[OK] **Completed**


## Session 24: Claude Entry and L2 cold-start evaluation

**Date**: 2026-09-09
**Task**: Claude Entry and L2 cold-start evaluation
**Branch**: `main`

### Summary

Delivered evaluation report: real Claude Hook emitted breadcrumb; public check did not pass; configured Gemini/antigravity route returned 429. L2 checkpoints not exercised (zero tools/tasks). Independent evidence review completed; temporary artifacts removed; original 9 dirty files unchanged. No product changes or Git commit.

### Git Commits

(No commits - planning session)

### Status

[OK] **Completed**


## Session 25: DeepSeek Entry and L2 recovery evaluation follow-up

**Date**: 2026-09-09
**Task**: DeepSeek Entry and L2 recovery evaluation follow-up
**Branch**: `main`

### Summary

User-selected deepseek/deepseek-v4-flash worked. Reproduced public Entry missing-stream-json observability defect. Interrupted execution samples did not close (controller/permission confounds preserved); controlled review changes -> cold repair -> independent review -> done passed 8 tests, frozen acceptance, doctor11. Independent evidence audit corrected cold1 task-show observation. Report updated retaining first round; all temporary artifacts removed, no product edits or Git commit.

### Git Commits

(No commits - planning session)

### Status

[OK] **Completed**


## Session 26: 修复 Entry 与跨会话恢复并完成 DeepSeek 盲测

**Date**: 2026-09-10
**Task**: 修复 Entry 与跨会话恢复并完成 DeepSeek 盲测
**Branch**: `main`

### Summary

修复 Claude Hook结构化检测、只读执行卡恢复、字段级结果诊断及重测发现的多Record doctor误报；6个DeepSeek盲测会话完成，同库只读复核通过。原始失败和限制已记录，临时产物清理，无Git提交。

### Main Changes

- 代码、回归与合同见09-10-tc-recovery-remediation归档任务；结果见development/evaluations/claude-entry-l2-recovery-2026-09-10.md

### Git Commits

(No commits - planning session)

### Testing

- [OK] 最终独立构建74文件514测试、产品type/lint/format/build通过；Watch桌面/移动6项通过；真实原库doctor均11/11，DB哈希不变

### Status

[OK] **Completed**

### Next Steps

- 需要更广模型/任务样本再评估Trellis迁移门；本轮不扩大能力声明。用户自行审阅并提交改动。


## Session 27: Evals 批量运行与两种 Agent 场景交付

**Date**: 2026-09-11
**Task**: Evals 批量运行与两种 Agent 场景交付
**Branch**: `feat/evals-batch-and-scenarios`

### Summary

完成批量选择/重复/并发/续跑、可信三态判定、盲评证据、L2 Review 回流及正常会话恢复；已完成独立审查并推送功能代码。六份历史运行的12个文件原样保留。

### Main Changes

- 批次 ledger 与只读中文看板接线，取消清理与路径/报告边界通过实证回归。
- 两个新场景使用真实 tc CLI 与 fake host 验证；judge 接收真实 controller 证据且不接收 code 评分。
- 共享评分 helper 已纳入方法指纹，QA subject Git SHA 保持独立；生产 src 和宿主配置未改。

### Git Commits

| Hash | Message |
|------|---------|
| `ddd0904` | (see git log) |
| `fa9635b` | (see git log) |
| `778ed7b` | (see git log) |
| `1781867` | (see git log) |

### Testing

- [OK] 集成阶段：620项全项目测试及类型/lint/格式/build通过。
- [OK] 后续边界修复：110项Evals测试与4项浏览器smoke通过；最终指纹修复10项定向测试通过。
- [OK] 父级实际请求3100页面/API均200，5个场景、6份历史报告；12份文件哈希一致。

### Status

[OK] **Completed**

### Next Steps

- QA 检出并构建推送分支后运行真实 Actor/Judge 批次；本地未运行新的真实测评。
