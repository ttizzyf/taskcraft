# Frontend 规范入口

Taskcraft 的生产 Watch 前端位于 `watch/`，只读 API 位于 `src/watch/`，自动
覆盖位于 `tests/watch/`。`development/prototypes/` 仍只是交互参考。

## Pre-Development Checklist

1. 阅读 [`Taskcraft 规范来源索引`](../taskcraft.md) 和任务涉及的产品规范。
2. 修改 Runtime/Diagnostics 的 Hook 状态时，阅读
   [`Entry Hook 跨层合同`](../backend/entry-hook-contract.md)。
3. 修改 L3 parent/child、anchor、coverage 或 runnable work 展示时，阅读
   [`L3 模块化跨层实现合同`](../backend/l3-modular-contract.md)。
4. 同步 `src/watch/routes.ts` 类型、`watch/render.js` 消费端和 `tests/watch/`。

## Quality Check

- Watch 只消费 API 返回的共享类型，不自行重新解释配置文件。
- Runtime 字段、渲染名称、空状态和诊断码同步更新。
- 运行 `tests/watch` 与 `pnpm smoke:watch`，并分别覆盖桌面和移动视图。

新增专题指南必须引用实际源码和测试，不得把静态原型当成生产合同。
