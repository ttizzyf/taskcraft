# Taskcraft 真实宿主 Smoke 记录（2026-08-12）

> 本文件是 Task 04（Host Adapter）的真实宿主验证记录。状态沿用
> `research/host-feasibility.md` 的五级定义（verified / documented /
> limited / pending / deferred）；"文档支持"与"本机真实验证"分列。
> 记录是研究证据，不进入产品数据模型。
>
> 后续更新：本文件保存 2026-08-12 的原始 smoke 快照。Codex S2 关于 Entry 的
> limited 结论已被 `dogfood-2026-08-13.md` D6 推翻；ADR 0009 已在
> 2026-08-14 移除 Stop Hook。下文 Stop 与 `enforced/advisory` 只属于历史证据，
> 不代表当前产品合同。当前公共 Entry 现场结果见
> [`entry-hook-smoke-2026-09-26.md`](entry-hook-smoke-2026-09-26.md)：Codex 与 Claude
> 均已真机通过（2026-08-17 时仅 Codex 通过）。

## 环境

| 工具 | 版本 | 登录 |
| --- | --- | --- |
| Codex CLI | 0.147.0 | 正常（`codex features list` 可用，hooks stable） |
| Claude Code | 2.1.220 | 正常（`claude auth` 已登录） |

边界：全部样本在临时目录 + 项目级/临时 hook 配置中执行；**全局宿主配置零改动**
（仅读 `~/.codex/`、`~/.claude/` 日志目录观察）；付费调用逐次获用户授权。

## 样本矩阵

| # | 样本 | 宿主 | 状态 | 备注 |
| --- | --- | --- | --- | --- |
| S1 | ordinary（无任务零注入） | codex | verified | `Reply exactly TC_FIRST.` 返回 TC_FIRST，input_tokens 与无 hook 基线一致（14342），无注入 |
| S2 | active（Entry 注入 + Stop） | codex | 历史 limited | 当时的 Entry 失败由错误引号导致，已被 D6 复验推翻；Stop 仍 limited |
| S3 | ordinary（无任务零注入） | claude | verified | `claude -p` 返回 TC_THIRD；session 日志无 hook_success（零注入零写入） |
| S4 | active（Entry 注入 + Stop） | claude | verified | session 日志 1×SessionStart hook_success（完整 breadcrumb 注入）+ 1×Stop exit 2（block）；修复 loop guard 后模型正常结束 |
| S5 | off（`enable off` 后零输出） | 本地 | local（测试覆盖） | `enable off` 后 entry/stop 脚本零输出 exit 0（hooks 测试 + 手动 smoke） |
| S6 | waiting（open blocker） | 本地 | local（测试覆盖） | decideStop 矩阵覆盖 waiting → allow；dogfood D2 补充真实宿主 waiting 静默验证 |
| S7 | done（完成后 allow） | 本地 | local（测试覆盖） | decideStop 矩阵覆盖 done → allow（hooks 测试） |
| S8 | timeout / malformed hook | 本地 | local（测试覆盖） | runHookTest fake-host 超时/malformed/非零退出路径（adapters 测试） |
| S9 | 中断后恢复 | 本地 | verified（dogfood D3 补充真实宿主） | breadcrumb 从 Task Store 重建（Task 02/03 测试）；dogfood D3 真实宿主同目录二次会话注入成功 |

## 详细记录

### S1（codex，ordinary 零注入）— verified

```bash
codex exec --dangerously-bypass-hook-trust --ephemeral --skip-git-repo-check \
  --sandbox read-only --json -c 'hooks.SessionStart=[{provider="command",
  command="node <tc>/dist/hooks/entry.js /tmp/nonexistent-config.json"}]' \
  "Reply exactly TC_FIRST."
```

结果：`agent_message: TC_FIRST`，`input_tokens: 14342`（与无 hook 基线一致）。
entry hook 读不到 config → 零输出 → 零注入。

### S2（codex，active）— limited

项目级 `.codex/config.toml`（`tc init --agent codex` 生成，SessionStart/Stop
已注册）在 `codex exec --ephemeral` 下**未被加载**（`--help` 证实 `-c` 只覆盖
用户配置 `~/.codex/config.toml`）；改用 `-c` 命令行传 hook 后，三次调用
（S1/S2/补跑）的 `input_tokens` 完全一致（14342/14344/14346），hook 未影响
模型输入。与 Task 00 探针 CX-02（2026-08-10，同版本 0.147.0）记录矛盾，差异
原因未定位（可能是项目 trust 策略或非交互模式对 hooks 的版本差异）。
**历史标记 limited：Entry 结论已被后续 D6 更新；Stop 结论见 D7。**

### S3（claude，ordinary 零注入）— verified

项目级 `.claude/settings.json`（SessionStart + Stop 注册）→ `claude -p "Reply
exactly TC_THIRD." --include-hook-events --setting-sources user,project` →
输出 TC_THIRD；session 日志（`~/.claude/projects/...tmp.../`）无
hook_success 记录 → 无 task 时零注入零写入 ✓。

### S4（claude，active 注入 + Stop 连续执行）— verified

建卡 + `run`（T-1 active）后 `claude -p "Reply exactly TC_FOURTH."`：

- **SessionStart hook 注入**（session 日志 `hook_success`，exitCode 0）：
  stdout 为完整 `tc-breadcrumb/v1` JSON——`{"task":{"id":"T-1","level":1,
  "status":"active",...,"node":"execute-1"},"next":{"command":"tc run complete
  T-1"}}` ✓（只注入定位信息 + 唯一 next，无上下文倾倒）
- **Stop block**：Stop hook exit 2 + breadcrumb 输出 ✓
- **loop guard**：修复前 stop.js 未读 `stop_hook_active` → 17 次 Stop 全部
  block（无限循环）；修复后读 stdin 放行 → 模型正常结束（exit 0 有输出）✓

### S5-S9（本地构造，无付费调用）— verified

hooks/adapters 测试覆盖：off 零输出、waiting/done → allow、timeout/malformed
hook 显式失败、中断后 breadcrumb 重建（Task 02/03 已验证投影可重建）。

## Stop Enforcement 判定

| 宿主 | 判定 | 依据 |
| --- | --- | --- |
| codex | advisory | D6 已验证 SessionStart/Entry；D7 在 exec 与真实 TTY 中均未观察到 Stop，用户已决定延期，不声明 enforced |
| claude | enforced | 本次 smoke 实测：SessionStart 注入 + Stop block + loop guard 放行（S4 verified）；与 Task 00 探针 CL-02（同版本）一致 |

## Smoke 中发现的缺陷（已修复）

1. **resolveTcPath 层级错误**（`src/adapters/shared.ts`）：`dist/adapters` 下
   `new URL("../../cli.js")` 解析到包根而非 `dist/`，生成的 hook 脚本引用
   不存在的 `<root>/hooks/entry.js` → 宿主静默忽略 hook。改为 `../cli.js`，
   conformance 与 CLI 集成测试增加构建产物路径断言。
2. **stop.js 未实现 `stop_hook_active` 防自循环**（`src/hooks/stop.ts`）：
   Stop hook 不读 stdin 输入，active 任务每次都 block → 宿主无限循环
   （实测 17 次）。改为解析宿主 Stop 输入 JSON 的 `stop_hook_active`，
   为 true 时 allow；补 `decideStopForHook` 纯函数与测试。

## 结论

- 静默入口 gate：普通问答 / off / 无 durable task 零注入零写入（S1/S3/S5）✓
- active task 只注入定位信息与唯一 next（S4；Codex 另见 D6）✓
- claude Stop Hook：enforced（S4 verified）；codex Entry verified、Stop advisory（D6/D7）
- observation 不驱动任务完成（Task 02/03 保证，projector 不读 agent_runs）✓
- Hook 失败显式进 diagnostics（S8 + TC_ADAPTER_* 错误映射）✓
- 全局宿主配置零改动 ✓（仅项目级/临时配置；日志只读观察）
