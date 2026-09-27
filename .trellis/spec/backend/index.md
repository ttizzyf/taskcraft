# Backend 规范入口

Taskcraft 的 TypeScript 生产实现位于 `src/`，测试位于 `tests/`。本目录只记录
已经由源码、测试和权威产品规范共同证明的实现合同，不复制产品定义。

## 已记录合同

- [Spec Registry 实现合同](spec-registry-contract.md)：Registry Schema、单一解析入口、
  安全文件读取、候选解析、`tc init` / `tc spec` 和稳定错误合同。
- [Entry Hook 跨层合同](entry-hook-contract.md)：Adapter、CLI、配置持久化、
  Watch Runtime/Diagnostics 的 SessionStart Entry 数据流。
- [宿主进程启动与终止合同](host-process-portability.md)：cmd.exe 启动、参数保真、
  超时终止整棵进程树、Codex 信任门的 TOML 解析。
- [L3 模块化跨层实现合同](l3-modular-contract.md)：accepted Plan 事务、真实 child、
  parent Projector、replan/reuse、Entry root 选择、CLI/Watch/doctor 同源合同。
- [Spec 生命周期绑定实现合同](spec-lifecycle-contract.md)：revision/node binding、
  L2/L3 原子继承、reuse Spec set、drift 与显式 refresh。
- [Spec 交付、收口与诊断实现合同](spec-delivery-contract.md)：Node/Review Brief、
  typed Spec Impact、共享 task show/Watch DTO 与 doctor 只读完整性。

## Pre-Development Checklist

1. 阅读 [`Taskcraft 规范来源索引`](../taskcraft.md) 和任务涉及的权威产品规范。
2. 修改 Registry、`src/spec/`、`tc init`、`tc spec` 或新增 Spec 消费者时，阅读
   [Spec Registry 实现合同](spec-registry-contract.md)。
3. 修改 Hook、Adapter、`tc agent` 或 Watch Hook 状态时，阅读
   [Entry Hook 跨层合同](entry-hook-contract.md)。
4. 修改宿主命令启动、超时、进程终止，或解析宿主自己的配置文件（如 Codex TOML）时，
   阅读 [宿主进程启动与终止合同](host-process-portability.md)。
5. 修改 L3 lifecycle、父子关系、Projector、replan/cancel、L3 CLI/Watch 或 doctor
   时，阅读 [L3 模块化跨层实现合同](l3-modular-contract.md)。
6. 先搜索命令名、配置字段和诊断码的全部生产与测试消费者。
7. 修改 lifecycle Spec binding、drift 或 refresh 时，阅读
   [Spec 生命周期绑定实现合同](spec-lifecycle-contract.md)。
8. 修改 Node Brief、Record 收口、task show/Watch Specs 或 doctor 时，阅读
   [Spec 交付、收口与诊断实现合同](spec-delivery-contract.md)。

## Quality Check

- CLI、Adapter、配置和 Watch 是否仍使用同一个 Entry Hook 结果合同。
- Registry、CLI 和后续消费者是否仍复用同一个 `src/spec/` 解析结果，且候选没有被
  自动提升为 binding。
- 新安装的完整 Hook 产物是否为两个等价 wrapper（`entry.sh` + `entry.mjs`）、
  当前平台的 SessionStart 注册和统一测试记录 schema。
- 带超时的宿主启动是否在根存活时终止整棵进程树，而不是只杀直接子进程。
- 失败是否保持非零退出和稳定诊断；真实宿主证据是否与自动测试分开报告。

新增专题指南必须引用实际源码、测试和权威规范，不得从阶段计划或研究材料单独
推导合同。
