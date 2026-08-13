# Hook install and test-hook rework

## Goal

重做 `tc agent test-hook`：测试**已安装**的 `.taskcraft/hooks/entry.sh` /
`stop.sh` + 真实 Task Store + breadcrumb；codex trust/feature gate 未满足
时明确失败；不再返回"advisory 成功"替代失败。

## Requirements

### REQ-01. 测试已安装链路

`tc agent test-hook --agent codex|claude` 必须：
- 校验 `.taskcraft/hooks/entry.sh` / `stop.sh` 存在且指向有效产物
  （dist/hooks/*.js 存在）。
- 校验项目级宿主配置（codex config.toml / claude settings.json）已注册
  这两个 hook；未注册 → 明确失败（不再 ok=true + limitation）。
- 用已安装脚本 + 真实 Task Store 跑 Entry 注入、Stop block、loop guard
  判定（spawn 宿主最小 prompt，解析 breadcrumb/stop 行为）。
- 结果含 testedAt / host version / ok / enforced。

### REQ-02. Codex trust/feature gate 明确失败

探测 `codex features list`（hooks feature）、项目 trust 状态与用户配置；
未满足 → `TC_ADAPTER_HOOK_TEST_FAILED` 或专用 code，stderr 三件套 +
非零退出；不得以 advisory 成功代替。

### REQ-03. enforced 判定

只有真实 Entry 注入 + Stop block + loop guard 全过才 enforced；
否则 advisory/失败原因明确。

### REQ-04. Tests

fake host 桩覆盖：脚本缺失、注册缺失、trust 未满足、注入失败、loop guard
通过/失败；conformance 更新（不再断言"config exists 部分成功"为 ok）。

## Acceptance Criteria

- [ ] test-hook 测已安装脚本与真实 breadcrumb；不再重装临时拷贝。
- [ ] 未安装/未注册/未批准 → 非零退出 + TC_ADAPTER_* 三件套。
- [ ] enforced 仅在三项全过时声明。
- [ ] 新增文件有效行 ≤ 400；`pnpm check` 全绿。

## Notes

- 父 design：config.hookTests 持久化字段由 test-hook 写入（与 D 共享合同）。
- 真实宿主调用逐次授权（F 阶段统一跑 dogfood）。
