# Build the Taskcraft Watch and diagnostics views

## Goal

为人类用户提供只读、本地、可扫描的任务视图与集中诊断：Board / Task Detail /
Runtime / Diagnostics 四个视图，全部消费同一 projector/query 模型，
localhost 随机端口 + 稳定深链，移动端基本可用。

## Background

- 来源需求是 `development/plans/task-06-watch.md`；依赖 Task 05 完成
  （覆盖 L1/L2/L3 状态）。
- Task 01-05 已完成：projector/query/reducer/adapter 就位；
  `development/prototypes/watch.html` 是交互参考（非规范）。
- 用户已确认：父 + 2 子任务（watch-server / watch-frontend）；前端用
  原生 ES modules（无 bundler/框架，符合工程约束）。
- 已冻结且不得改动：storage.sql、schemas、既有 fixtures、specs/、plans/。

## Requirements

### REQ-01. Read-only Board

Watch Board：Active / Waiting / Queued / Done / Cancelled 分组；每卡显示
标题、Level、公开状态、当前节点、required 完成度、blocker、宿主、最后活动、
下一动作。页面不保存或手工编辑任务状态；删除缓存后可从 Task Store 重建。

### REQ-02. Task Detail

目标、范围、非目标、验收、Level 与判级理由、当前 lifecycle revision 与节点
图、每节点义务及完成度、evidence、Review finding/attempt、事件时间线、
下一条 CLI 命令。

### REQ-03. Review 与独立性披露

Review purpose、reviewed attempt、capability 与 independence status 如实
展示；独立性不能被颜色或文案夸大（same-actor/unverified 明示）。

### REQ-04. Runtime & Diagnostics 分层

Runtime：agent_runs observation（host/run id/node/attempt/last seen/finish
reason）独立视觉层级，与 Task facts 分层；observation stale/finished 与
Task active/done 可同时正确展示。Diagnostics：Hook、migration、revision
conflict、evidence missing、unsupported host、timeout 集中展示（只读）。

### REQ-05. Server & Access

localhost 127.0.0.1 随机端口、单会话；深链在同一 Watch 会话内稳定
（board/#/task/T-104 之类）；`--no-open` 只打印 URL。所有写操作只能调用
Command service（首版视图只读，不提供写入口）。

### REQ-06. State Matrix & Smoke

状态矩阵覆盖 product.md §7 的视图状态（未初始化/off/ask/always、五状态、
L1/L2/L3、execute/review/integrate/record 当前节点、required 缺失、Review
三 outcome、stale/finished、revision conflict 等）；desktop/mobile 不出现
内容重叠或关键操作不可达。

### REQ-07. Non-goals

- 不实现云同步、账号、远程协作、可编辑 Board。
- 不把原型静态数据带入生产路径（页面数据全来自 projector JSON API）。
- 不引入 bundler/框架（原生 ES modules + Node http）。

## Acceptance Criteria

- [ ] 页面不保存或手工编辑任务状态；删除缓存后可从 Task Store 重建相同视图。
- [ ] waiting 展示 waitingReason、责任方与恢复动作。
- [ ] Review 独立性不被颜色或文案夸大。
- [ ] observation stale/finished 与 Task active/done 同时正确展示。
- [ ] Desktop 与 mobile 不出现内容重叠或关键操作不可达。
- [ ] 深链在同一 Watch 会话内稳定；`--no-open` 只打印 URL。
- [ ] 新增文件有效行 ≤ 400；`pnpm check` 全绿；`git diff --check` 干净。

## Child Task Map

| 子任务 | 交付物 | 独立可检查点 |
| --- | --- | --- |
| `watch-server` | Node http 服务、随机端口、JSON API（同源 projector）、深链、静态服务 | API 只读同源；深链稳定；127.0.0.1 随机端口 |
| `watch-frontend` | Board/Detail/Runtime/Diagnostics 页面、状态矩阵、desktop/mobile smoke | 五状态分组；独立性如实展示；无重叠 |

依赖顺序：`watch-server` → `watch-frontend`；父任务负责状态矩阵与最终验收。

## Notes

- 设计阶段先从 projector contract 生成状态矩阵，不复制原型数据结构。
- 验收时比较页面、CLI JSON 与 breadcrumb 的状态一致性。
