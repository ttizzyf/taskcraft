# 迁移门 §1 逐条复核（2026-09-27）

对 [`runbooks/trellis-to-taskcraft.md`](runbooks/trellis-to-taskcraft.md) §1 的 7 条进入条件
逐条盘点**现有证据**。

**本表只做证据盘点，不改变门的判定。** 判定项（尤其第 5 条的"冻结"）留给项目负责人。

代码基线：`f899fc8`（2026-09-27，已推送）。自动测试基线：**613 通过 / 0 失败 / 2 跳过**。

---

## 总览

| # | 进入条件 | 判定 | 主要证据 |
| --- | --- | --- | --- |
| 1 | Task 00–06 验收完成，MVP 发布门通过 | ❌ **未通过** | Task 00–06 全部归档；但 `task-07-*.md` 自己声明"仍不得据此宣称 MVP 发布门已满足" |
| 2 | Store / 事务 / CAS / 单 reducer-projector / 只读 doctor 通过，且 doctor 覆盖 Spec 全链 | ✅ **证据充分** | 见 §2 |
| 3 | L1/L2 在至少一个真实宿主完成创建、恢复、waiting/resume、Review、done 样本 | ✅ **证据充分** | evals 三案例（2026-09-26）全 pass + 08-13/09-10 注入样本，见 §3 |
| 4 | 双宿主 Entry Hook 安装、恢复、现场检测通过 | ✅ **已关闭** | 见 §4 |
| 5 | Node Brief / Spec delivery / Spec Impact / Command Result / evidence / breadcrumb 合同已冻结 | ⚠️ **契约与验证都齐，但无人声明"冻结"** | 见 §5 |
| 6 | 带真实 Git Spec 的 L1/L2/L3 single/modules 公共 CLI 闭环 + 旧 revision 兼容闭环 | ✅ **基本齐**（1 处小缺口） | 见 §6 |
| 7 | Watch 不影响 CLI 恢复；Task 06 已完成 | ✅ **满足** | 见 §7 |

**统计**：明确满足 4 条（②③④⑦），有证据但需判断 2 条（⑤⑥），明确未通过 1 条（①）。

---

## 逐条明细

### ① Task 00–06 验收完成，MVP 发布门通过 —— ❌ 未通过

- **前半句满足**：Task 00（08-10）、01（08-11）、02（08-11）、03（08-12）、04（08-12）、
  05（08-13）、06（08-13）全部完成或归档。
- **后半句不满足**：`plans/task-07-mvp-readiness-remediation.md` 明确写着
  "迁移手册 §1 的进入条件尚未逐条重新复核，因此**仍不得据此宣称 MVP 发布门**或
  Trellis → Taskcraft 狗粮化进入条件已经满足"。
- `dogfood-2026-08-13.md` 的复核表把这一行的证据指向 "Task 07 复核"，
  即 **MVP 门由 Task 07 的验收决定**，而 Task 07 尚未验收。

> 这一条与整张表互为条件：MVP 门要靠 §1 复核来关，而 §1 第 1 条又要求 MVP 门已关。
> 需要先明确二者的先后，否则会原地打转。

### ② Store / 事务 / CAS / 单 reducer-projector / 只读 doctor —— ✅ 证据充分

| 覆盖点 | 证据 |
| --- | --- |
| migration / 外键 / 孤儿 / 事件连续性 / digest / 投影重建 / breadcrumb | `tests/core/doctor.test.ts`（含 `passes all ten Store checks on a migrated empty store`） |
| Spec Registry / binding drift / provenance / Spec Impact | `tests/core/doctor-spec.test.ts`（8 例）、`tests/core/doctor-record-retries.test.ts` |
| doctor 公共 CLI | `tests/cli/doctor.test.ts` |
| 事务 / CAS / 回滚 | `tests/store/*`、fixture `transaction-rollback` / `revision-conflict` |
| 单 reducer（30 个命令处理器） | `tests/core/reducer.*.test.ts`（30 个文件） |
| 纯 projector | `tests/core/projector*.test.ts`（含 L3 / review / fixtures） |

### ③ 真实宿主 L1/L2 样本 —— ✅ 证据充分

**测评框架（2026-09-26 构建）**：`evals/runs/` 共 16 份报告，最新三份**全部 pass**，
宿主均为 claude 2.1.177，底层模型 `deepseek/deepseek-v4.1-flash[1M]`：

| 案例 | 报告 | 覆盖 | 结果 |
| --- | --- | --- | --- |
| delivery | `delivery-2026-09-26T06-18-44-920Z.md` | 创建 → 执行 → done | pass（406s / 153 calls；7 项 code + 3 项 model 全 pass） |
| recovery | `recovery-2026-09-26T06-14-45-954Z.md` | 中断 → 跨会话恢复 → done | pass（中断 40.6s / 恢复 338s，含 `recovery-checkpoint:pass`） |
| review | `review-2026-09-26T06-22-03-092Z.md` | 审查 + 修复 | pass（411s / 116 calls，含 `tc-fixture-provenance:pass`） |

三个案例合起来覆盖"创建 / 恢复 / 审查修复"三条主流程，且都在真实宿主里跑到 done。
`evals/` 已运行过多次（16 份报告），**无需再重跑**。

**Entry Hook 注入样本**：`dogfood-2026-08-13.md` 在 claude 宿主上取得 D1–D5
（L1 创建 + breadcrumb 注入 / waiting 静默 / 跨会话恢复注入 / L2 review 注入 / L2 done 后零注入）；
`evaluations/claude-entry-l2-recovery-2026-09-10.md` 复测"Entry 检测与冷启动恢复"通过。
这一组补齐了 evals 未直接覆盖的 **waiting/resume 与 L2 review/done 注入**。

**说明**：D1–D5 取自 08-13 / 09-10 的构建，三份 evals 报告取自 09-26 的构建。
09-27 之后的提交为文档同步、测试 harness 跨平台修正、recovery 案例临时目录回收，
以及 POSIX wrapper 的路径引号归一 —— 均不改变上述流程本身的行为。

### ④ 双宿主 Entry Hook —— ✅ 已关闭

2026-09-26 于 Windows 本机实测，两个宿主均 `entryInjected: true`：

| 宿主 | 版本 | 耗时 |
| --- | --- | --- |
| claude | 2.1.177 | 8.8s（改异步杀树后复测 9.0s） |
| codex | 0.155.1 | 15.5s（复测 14.9s） |

详见 [`entry-hook-smoke-2026-09-26.md`](entry-hook-smoke-2026-09-26.md)。

### ⑤ 合同已冻结 —— ⚠️ 实物齐、有一处自评勾选，但无正式冻结声明

手册点名的 6 项合同，实物落点如下：

| 合同 | 版本标识 | 落点 |
| --- | --- | --- |
| breadcrumb | `tc-breadcrumb/v1` | `contracts/breadcrumb.schema.json`（JSON Schema） |
| lifecycle revision（含节点与 obligation） | `tc-lifecycle/v1` | `contracts/lifecycle.schema.json`（JSON Schema） |
| Spec Registry | `tc-spec-registry/v1` | `contracts/spec-registry.schema.json`（JSON Schema） |
| Node Brief | `tc-node-brief/v1` | `src/core/node-brief.ts`（TS 类型，无独立 schema 文件） |
| Command Result | `tc-command-result/v1` | `src/core/command-result.ts`（TS 类型，无独立 schema 文件） |
| Spec delivery / Spec Impact / evidence | — | 作为字段落在 lifecycle / command-result 内，无独立契约 |

表结构与运行时校验：`contracts/storage.sql`、`src/contracts/schemas.ts`（Ajv 2020 strict）；
`tests/contracts/schemas.test.ts` 编译全部 Draft 2020-12 schema 并验证非法实例被拒。

**仓库里唯一一处"已冻结"的说法**是 `dogfood-2026-08-13.md` 的迁移门复核表第 5 行
（`✅ | Task 02-06 交付`）——那是 08-13 的一次**自评勾选**，没有写清冻结范围、版本号、
变更流程与责任人，也没有后续维护。除此之外没有任何地方正式声明。

**所以缺的不是"合同"，而是"冻结这件事本身"的定义**：冻结到什么版本、以后谁能改、
改的时候要做什么（升版本号？留旧 revision 兼容路径？）。**需要负责人拍板。**

### ⑥ 公共 CLI 闭环 —— ✅ 基本齐

| 闭环 | 证据 |
| --- | --- |
| L1 无 Spec 跑到 done | `tests/cli/run.test.ts` — `runs the full L1 loop to done with --result @path` |
| L1 + Spec 的 CLI 路径 | `tests/cli/spec-lifecycle.test.ts` — `blocks stale required Execute bindings until explicit refresh`（`--level 1 --specs`，覆盖建卡绑定 → 漂移拦截 → refresh → 开工） |
| L2 + Spec 跑到 done | `tests/cli/spec-lifecycle-closures.test.ts` — `runs a public L2 closure with exact Specs and a domain candidate Impact` |
| L3 single + Spec | 同文件 — `runs a public L3 single closure with accepted execution Specs` |
| L3 modules | `tests/cli/l3.test.ts` — `drives the main loop to done with the on-demand integration review` |
| 旧 revision 无 binding/Impact 兼容 | `tests/cli/spec-impact.test.ts` — `completes a pre-0003 stored revision through the public CLI without Spec Impact`；`tests/core/reducer.spec-compatibility.test.ts` — `keeps legacy L1/1, L2/1, L3/2 and child/1 contracts completable` |

**小缺口**：**L1 带 Spec 跑到 done 的单条完整闭环**没有独立用例——现在是被拆成
两半覆盖的（L1 无 Spec 到 done + L1 有 Spec 的拦截路径）。

**另一个措辞问题**：测试里的 Spec 是临时目录中**真实写入的** markdown + registry
（`writeRegistry()` 写 `docs/core.md` 与 `.taskcraft/spec/index.json`），
不是仓库自身的 spec。若门槛要求"本仓库的 Git Spec"，则需另行确认。

### ⑦ Watch 与 Task 06 —— ✅ 满足

- Task 06（Watch）已归档（2026-08-13），Task 07 补齐 Diagnostics。
- `tc watch` 是纯只读投影，`tc task list` / `task show` 读取同一 Task Store，
  **CLI 恢复不依赖 Watch**（`specs/cli.md` §6 明确）。
- `tests/watch/*` 覆盖服务与路由；`smoke:watch` 覆盖页面。

---

## 真正还缺什么

按"要动手做"的性质排序：

| # | 缺什么 | 性质 |
| --- | --- | --- |
| 1 | **§1 第 1 条与 MVP 门的先后定义** | 决策。否则整张表循环依赖 |
| 2 | **合同冻结的正式声明**（⑤） | 决策，一句话的事 |
| 3 | **L1 带 Spec 到 done 的单条闭环用例**（⑥） | 动手，小 |
| 4 | **确认"真实 Git Spec"是否指本仓库自身的 spec**（⑥） | 决策 |

**③ 已从待补项移除**：`evals/runs/` 已有 16 份报告，最新 delivery / recovery / review 三份
（2026-09-26）全部 pass，覆盖"创建 / 恢复 / 审查修复"，不需要再重跑真实宿主。
剩下的四项都是决策或小改动，**没有需要付费宿主调用的部分**。

---

## 附：本表使用的证据来源

- 代码与测试：`src/`、`tests/`（96 个测试文件）
- 真实宿主记录：`evals/runs/*.md`（16 份，最新三份 2026-09-26 全 pass）、
  `dogfood-2026-08-13.md`、`entry-hook-smoke-2026-09-26.md`、
  `evaluations/claude-entry-l2-recovery-2026-09-*.md`
- 契约：`development/contracts/`
- 计划与状态：`plans/roadmap.md`、`plans/task-07-mvp-readiness-remediation.md`
