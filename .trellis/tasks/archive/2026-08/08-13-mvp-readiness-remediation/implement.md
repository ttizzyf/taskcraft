# Implement: MVP readiness remediation

## Execution Order

A/B/C 并行启动（各自独立实现/审查/归档）→ E 决定 → D（依赖 B/C 合同）→ F
（依赖 A–D）→ 父任务迁移门复核。

## Ordered Checklist

### Phase A: mvp-doctor
1. `src/core/doctor.ts`（检查器纯函数）+ `src/commands/doctor.ts`。
2. 检查项：ledger/checksum（复用 migrations 校验）、外键
   （foreign_key_check）、孤儿引用（evidence/attempt/fact 引用完整性）、
   事件连续性（task_seq 连续）、definition digest（重算 vs 存储）、
   projector 重建（project() 可执行）、breadcrumb schema。
3. 损坏库测试（构造损坏 → 稳定错误 + 非零退出 + 零修改断言）。
4. check 全绿 → trellis-check → 提交 → 归档。

### Phase B: mvp-waiting-resume-retry
1. reducer：taskWait / taskResume / runRetry / runFail（attempt failure
   公开路径）+ blocker 生命周期（open/resolved + 事件）。
2. 命令：`tc task wait --reason <code> --message`、`tc task resume`、
   `tc run retry --attempt <id> --reason`、`tc run fail <id> --attempt <id>
   --reason`。
3. 覆盖四类 waitingReason；CAS + 事务 + 事件连续性测试；
   `active -> waiting -> active -> done` CLI 集成测试。
4. check 全绿 → trellis-check → 提交 → 归档。

### Phase C: mvp-hook-rework
1. test-hook 改为测试**已安装** entry.sh/stop.sh + 真实 Task Store +
   breadcrumb（不重装拷贝）；未安装/未注册/未批准 → 明确失败。
2. codex trust/feature gate 探测：`codex features list`、项目 config 存在性
   与 hooks 注册检查；未满足显式 TC_ADAPTER_* 失败。
3. enforced 判定：真实 Entry 注入 + Stop block + loop guard 全过。
4. conformance 更新 + CLI 测试；check 全绿 → trellis-check → 提交 → 归档。

### Phase D: mvp-runtime-diagnostics
1. `tc run attach` / `tc run status`（agent_runs 写/读，reducer 事务）。
2. test-hook 结果持久化（config.hookTests）+ Watch diagnostics 同源读取。
3. observation finished 不驱动 done 的公开路径复证。
4. check 全绿 → trellis-check → 提交 → 归档。

### Phase E: mvp-l3-children（决定先于实现）
1. 向用户提交二选一（推荐收窄单 execute）。
2. 按决定同步 lifecycle.md §5 / l3 fixtures / 测试 / 文档声称。

### Phase F: mvp-dogfood-docs
1. 命令面收敛（state 命令化 + 延期标记 + help/cli.md 一致）。
2. 公开 CLI 真实宿主 dogfood：L1/L2 创建/恢复/waiting/resume/Review/done
   （逐次授权）。
3. 文档同步（README/roadmap/handoff/host-smoke 用词区分）。
4. 迁移门复核：`development/runbooks/trellis-to-taskcraft.md` 进入条件逐条
   重跑，结论 pass 或 blocked 写入文档。

## Validation Commands

```bash
pnpm check
git diff --check
pnpm smoke:watch
node dist/cli.js doctor --json
```

## Review Gates

- 每子任务提交前：pnpm check 全绿 + git diff --check + trellis-check。
- 禁止 fixture/mock marker 冒充生产路径；真实宿主调用逐次授权。
- 冻结文件（storage.sql/schemas/specs 既有部分）零改动；规范同步走文档修订。

## Rollback Points

- A/B/C 独立回退（互不依赖）。
- D 依赖合同不满足时回 B/C 修正。
- E 决定影响面大，先记录决定再实现。
