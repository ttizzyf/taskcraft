# 任务 06：Watch 与 Diagnostics

## 目标

为人类用户提供只读、本地、可扫描的任务视图，并把宿主、Store、revision、evidence 和 Hook 异常集中到可操作的诊断界面。

## 依赖

- 任务 05 完成，以便一次覆盖 L1/L2/L3 状态。
- Runtime 视图的完整能力依赖任务 04。
- UI 行为必须使用同一个 projector 查询模型。

## 必读输入

- `development/specs/product.md` 的信息架构与视图状态
- `development/specs/architecture.md`
- `development/prototypes/watch.html`
- 已实现的 query projector contract

## 范围

1. Watch Board：Active、Waiting、Queued、Done、Cancelled。
2. Task Detail：目标、范围、验收、Level、revision、节点、义务、证据和时间线。
3. Review purpose、reviewed attempt、capability 和 independence status。
4. Runtime observation 与 Task facts 的视觉分层。
5. Diagnostics：Hook、migration、revision conflict、evidence、unsupported host 和 timeout。
6. localhost 随机端口、稳定深链和移动端基本可用性。
7. 所有写操作只能调用 Command service；首版可只实现明确需要的操作入口。

## 交付物

- Watch 服务和前端。
- Board、详情、Runtime、Diagnostics 页面。
- Desktop/mobile smoke fixtures。
- 状态与原型覆盖矩阵。

## 验收标准

- 页面不保存或手工编辑任务状态。
- 删除页面缓存后能从 Task Store 重建相同视图。
- waiting 必须展示 waitingReason、责任方和恢复动作。
- Review 独立性不能被颜色或文案夸大。
- observation stale/finished 与 Task active/done 可以同时正确展示。
- Desktop 和 mobile 不出现内容重叠或关键操作不可达。

## 非目标

- 不实现云同步、账号系统或远程协作。
- 不实现可编辑 Markdown Board。
- 不把原型静态数据带入生产路径。

## 验证

1. Projector/query tests。
2. 前端类型检查和构建。
3. Playwright desktop/mobile smoke。
4. 页面状态与 CLI JSON 对照检查。

## 后续启动提示

任务标题：`Build the Taskcraft Watch and diagnostics views`

本阶段仍由 Trellis 管理，可用已实现的 L2 fixture 做 tc 旁路 smoke，但不能双写活动任务。设计阶段先从 projector contract 生成状态矩阵，不能先复制原型数据结构；Review 阶段同时比较页面、CLI JSON 和 breadcrumb 的状态一致性。
