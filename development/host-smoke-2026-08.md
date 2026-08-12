# Taskcraft 真实宿主 Smoke 记录（2026-08-12）

> 本文件是 Task 04（Host Adapter）的真实宿主验证记录。状态沿用
> `research/host-feasibility.md` 的五级定义（verified / documented /
> limited / pending / deferred）；"文档支持"与"本机真实验证"分列。
> 记录是研究证据，不进入产品数据模型。

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
| S2 | active（Entry 注入 + Stop） | codex | limited | 见下：`codex exec --ephemeral` 不加载项目 `.codex/config.toml`；`-c` 传 hook 也未见执行（与 Task 00 探针 CX-02 记录矛盾，待交互会话复验） |
| S3 | ordinary（无任务零注入） | claude | verified | `claude -p` 返回 TC_THIRD；session 日志无 hook_success（零注入零写入） |
| S4 | active（Entry 注入 + Stop） | claude | verified | session 日志 1×SessionStart hook_success（完整 breadcrumb 注入）+ 1×Stop exit 2（block）；修复 loop guard 后模型正常结束 |
| S5 | off（`enable off` 后零输出） | 本地 | verified | `enable off` 后 entry/stop 脚本零输出 exit 0（hooks 测试 + 手动 smoke） |
| S6 | waiting（open blocker） | 本地 | verified | decideStop 矩阵覆盖 waiting → allow（hooks 测试） |
| S7 | done（完成后 allow） | 本地 | verified | decideStop 矩阵覆盖 done → allow（hooks 测试） |
| S8 | timeout / malformed hook | 本地 | verified | runHookTest fake-host 超时/malformed/非零退出路径（adapters 测试） |
| S9 | 中断后恢复 | 本地 | verified | breadcrumb 从 Task Store 重建（Task 02/03 测试与 smoke） |

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
**标记 limited：codex exec 非交互 hooks 待交互会话复验。**

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
| codex | advisory | 真实 exec smoke 未观察到 hook 效果（S2 limited），Task 00 探针 CX-02 为 verified 但本机当前未复现；交互会话复验前不声明 enforced |
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
- active task 只注入定位信息与唯一 next（S4）✓
- claude Stop Hook：enforced（S4 verified）；codex：advisory（S2 limited）
- observation 不驱动任务完成（Task 02/03 保证，projector 不读 agent_runs）✓
- Hook 失败显式进 diagnostics（S8 + TC_ADAPTER_* 错误映射）✓
- 全局宿主配置零改动 ✓（仅项目级/临时配置；日志只读观察）
