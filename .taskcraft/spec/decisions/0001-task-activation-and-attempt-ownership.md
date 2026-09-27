# ADR 0001：任务激活与 Attempt 归属

- 状态：已接受
- 日期：2026-08-10
- 范围：Task 00

## Context

当前 CLI 一处写明 `task new` 会激活任务并创建首个 attempt，另一处又把
`queued` 定义为“已登记但尚未激活”。这让建卡、开始执行和 attempt 领取
成为三个重叠入口。

## Decision Drivers

- `queued` 必须有真实用途。
- 激活只能有一个写入口。
- attempt 必须属于明确的 node 和 revision。
- 用户可以先建卡、检查 Level 和合同，再决定是否开始执行。
- 建卡不能要求 Agent 一次填完所有可能的风险和执行信息。

## Options

1. `task new` 同时建卡、激活并创建 attempt。命令少，但 `queued` 基本不可见。
2. `task new` 建卡，`task run` 激活并领取首个 attempt。边界清楚。
3. 增加独立 `task activate`。语义清楚，但多出一个没有额外价值的命令。

## Decision

采用选项 2：

- `tc task new` 只创建 Task、初始 lifecycle revision 和 required obligations。
  成功后的公开状态是 `queued`，不写 `activated_at`，不创建 attempt。
- 建卡只要求目标、Level 和判级理由。其他事实按需补充；字段不存在就表示尚未
  提供，不增加 `unknown` 枚举或占位记录。
- `tc run <task-id>` 是 `queued -> active` 的唯一触发命令。第一次调用在同一
  reducer 事务中写激活事实，并为当前首个 runnable node 创建或领取 attempt。
- 已激活任务上的后续 `tc run` 只创建或领取目标 node attempt，不重复激活。
- `tc task next` 对 queued task 返回唯一 next：`tc run <task-id>`。
- attempt 的 node 和 lifecycle revision 在创建时固定。actor 与 host 只记录
  实际执行关系；宿主 run 只是观察关联，不能反向成为激活事实。

## Consequences

- 建卡可以独立审阅和取消。
- L1 不再宣称 `task new` 已创建 Execute attempt。
- `task new` 与 `run` 各多一个清楚的事务合同。
- CLI 示例需要多一条 `tc run`，这是保留 queued 语义的必要成本。

## Exit Cost

低。仓库尚无生产数据。若以后希望一步执行，可以增加组合命令，但组合命令
仍必须调用同一 `new` 与 `run` command service，不得新增激活规则。

## Contract Mapping

- lifecycle：定义 queued、activation 和 runnable。
- architecture：定义 reducer 事务和 projector 条件。
- CLI：删除 `task new` 的激活/attempt 写入，修改 L1 示例和 transition table。
- SQL：`tasks.activated_at` 只由 run activation command 写入。

## Task 01 Input

Task 01 只建立能够表达 queued Task、activation 和 attempt 的 migration 与合同
测试，不实现命令。`createTask()` 和 `startRun()` 留给 Task 02 的 L1 纵切。

## Evidence

- `development/specs/cli.md` 第 4、5、7 节的现有冲突。
- `development/specs/architecture.md` 的五状态投影定义。
