# Design: Repository Contract Baseline

## Documentation Shape

`development/README.md` 保持唯一开发入口，新增 ADR 索引但不复制 ADR 结论。
阶段计划引用冻结合同；Trellis 父子任务不反向成为产品规范。链接检查覆盖仓库
内 Markdown 相对路径和锚点，外部 URL 单独报告网络限制。

## Module Boundary Handoff

Task 00 只定义责任边界和预期入口，例如 command/reducer/projector/store、
contracts/migrations、adapter 和 tests；实际顶层目录、包配置和空入口由 Task 01
按 ADR 创建。边界文档必须指出 dependency direction 和唯一写入口，但不得
提前设计完整类层级。

## Integration Evidence

最终报告使用父 PRD requirement/acceptance id 到 ADR、spec section、contract
file 和验证命令的矩阵。每条只有一个权威目标位置，可以有多个验证证据。

## Rollback

本子任务只改索引、模块边界、阶段交接和验证记录；可独立回退，不改变已冻结
运行时合同。若发现真正合同缺陷，返回前一子任务处理。
