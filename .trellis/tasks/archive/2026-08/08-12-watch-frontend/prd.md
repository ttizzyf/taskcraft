# Watch frontend views

## Goal

用原生 ES modules 交付四个只读视图：Board、Task Detail、Runtime、
Diagnostics；状态矩阵覆盖 product.md §7 的视图状态；desktop/mobile smoke
通过。

## Requirements

### REQ-01. Board View

五状态分组（Active/Waiting/Queued/Done/Cancelled）+ 每卡摘要（标题/Level/
状态/当前节点/required 完成度/blocker/宿主/最后活动/next）；点击进入 Detail。
waiting 卡展示 waitingReason、责任方与恢复动作。

### REQ-02. Task Detail View

目标/范围/非目标/验收、Level 与判级理由、当前 lifecycle revision 与节点图、
每节点义务完成度、evidence、Review finding（含 reviewed attempt / purpose /
capability / independence）、事件时间线、下一条 CLI 命令。Review 独立性
（same-actor/unverified/observed-distinct）明示，不做夸大渲染。

### REQ-03. Runtime & Diagnostics Views

Runtime：host/run id/node/attempt/last seen/finish reason 独立视觉层级
（observation 与 Task facts 分离）；stale/finished observation 与 Task
active/done 同时正确展示。Diagnostics：hook/migration/revision conflict/
evidence/unsupported host/timeout 聚合列表。

### REQ-04. Same-source Rendering

页面数据 100% 来自 JSON API（fetch）；无第二套状态推导；加载失败显示
显式错误（不静默）。

### REQ-05. Responsive & Smoke

Desktop 与 mobile（≤420px）无内容重叠、关键操作可达；状态矩阵覆盖
product.md §7 列出的视图状态（至少代表性样本）；页面状态与 CLI JSON 对照
一致。

## Acceptance Criteria

- [ ] 五状态分组正确；waiting 展示 waitingReason、责任方与恢复动作。
- [ ] Review 独立性如实展示（不夸大）。
- [ ] Runtime observation 与 Task facts 视觉分层；stale/finished 与
      active/done 并存正确。
- [ ] Desktop/mobile smoke 无重叠、关键操作可达。
- [ ] 页面只读，数据全来自 API。
- [ ] 新增文件有效行 ≤ 400（JS 文件）；`pnpm check` 全绿。

## Non-goals

- 不实现写操作入口、编辑 Board、云同步。
- 不引入 bundler/框架（原生 ES modules，无构建步骤）。

## Notes

- 依赖已归档的 watch-server；HTML/CSS/JS 在 `watch/` 目录。
- 状态矩阵先由 projector contract 生成，再对照页面与 CLI JSON。
