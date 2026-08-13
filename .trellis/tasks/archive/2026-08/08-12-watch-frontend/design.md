# Design: Watch frontend views

## Structure（watch/ 目录，原生 ES modules）

```text
watch/
  index.html      # 单页：导航（Board/Detail/Runtime/Diagnostics）+ 视图容器
  app.js          # hash 路由 + fetch API + 渲染（ES module，无依赖）
  style.css       # 设计令牌（颜色/间距）+ responsive 布局
```

- hash 路由：`#/board`、`#/task/<id>`、`#/runtime`、`#/diag`；深链同一会话
  内稳定（刷新保持）。
- 数据：app.js fetch `/api/*`；视图渲染纯函数（data → DOM）；加载失败显示
  显式错误面板（不静默）。

## 视图

### Board（#/board）

- 五组：Active / Waiting / Queued / Done / Cancelled（每组空态显示"无"）。
- 卡片：标题、Level 徽标、状态、当前节点、required `done/total`、blocker
  （waiting 卡：waitingReason + remediation 命令）、host、next 命令。
- 点击卡片 → `#/task/<id>`。

### Task Detail（#/task/<id>）

- 头部：标题/Level/判级理由/status/revision/lifecycleRevision/next 命令。
- 内容区：目标/范围/非目标/验收；节点图（列表，状态符号
  satisfied✓ running▶ runnable○ blocked⊗ + attempt id）；义务表（duty/
  状态/evidence id）；evidence 表；Review findings（severity/disposition/
  reviewed attempt/purpose/capability/independence——独立性为文本标签，
  无颜色夸大）；Task facts（category/subject/value/created_by）；
  事件时间线（event_type/task_seq/occurred_at）。

### Runtime（#/runtime）

- 独立面板：observation 表（host/run id/session id/node/attempt/
  observation_status/last_seen/finish_reason）；与 Task facts 视觉分离
  （分区 + 不同样式）。

### Diagnostics（#/diag）

- 诊断列表（code/problem/impact/remediation/source）；空态"无已知问题"。

## Responsive

- Desktop（≥900px）：Board 五列或分组两行；Detail 双栏（节点图 + 明细）。
- Mobile（≤420px）：单列堆叠；导航折叠为顶栏 tabs；无横向溢出
  （overflow-x 隐藏 + 卡片最小宽度适配）；表格转卡片式列表。

## 状态矩阵（验收用例）

从 projector contract 生成（父 design 状态矩阵段）：每状态 × 每视图断言；
Playwright smoke 覆盖 desktop/mobile 两个 viewport + 代表状态集。
Playwright 依赖：先 `pnpm view playwright` 确认 npmmirror 可用；不可用时
降级为 vitest + jsdom 渲染断言（显式记录降级）。

## Tests

- 渲染纯函数测试（数据 → DOM 结构断言）。
- 状态矩阵用例（构造 API 响应 → 页面断言：五状态分组、waiting 三件套、
  独立性标签、stale/finished 并存）。
- Playwright（可用时）：desktop/mobile 无重叠、深链直达、刷新保持。
