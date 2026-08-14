# Backend 规范入口

Taskcraft 的 TypeScript 生产实现位于 `src/`，测试位于 `tests/`。本目录只记录
已经由源码、测试和权威产品规范共同证明的实现合同，不复制产品定义。

## 已记录合同

- [Entry Hook 跨层合同](entry-hook-contract.md)：Adapter、CLI、配置持久化、
  Watch Runtime/Diagnostics 的 Entry-only 数据流。

## Pre-Development Checklist

1. 阅读 [`Taskcraft 规范来源索引`](../taskcraft.md) 和任务涉及的权威产品规范。
2. 修改 Hook、Adapter、`tc agent` 或 Watch Hook 状态时，阅读
   [Entry Hook 跨层合同](entry-hook-contract.md)。
3. 先搜索命令名、配置字段和诊断码的全部生产与测试消费者。

## Quality Check

- CLI、Adapter、配置和 Watch 是否仍使用同一个 Entry Hook 结果合同。
- 新安装是否只产生 `entry.sh`/SessionStart，且没有 Stop 兼容壳或第二套 schema。
- 失败是否保持非零退出和稳定诊断；真实宿主证据是否与自动测试分开报告。

新增专题指南必须引用实际源码、测试和权威规范，不得从阶段计划或研究材料单独
推导合同。
