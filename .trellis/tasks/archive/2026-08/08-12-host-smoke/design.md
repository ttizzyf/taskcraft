# Design: Real-host smoke and records

## 样本矩阵

| 样本 | 执行方式 | 断言 |
| --- | --- | --- |
| ordinary | 普通 prompt（无 task） | Hook 零输出、DB 零写入 |
| off | `tc enable off` 后 prompt | 零输出、零写入 |
| active | 建 L1 task + run 后 prompt | 注入 breadcrumb（anchor + next），无上下文倾倒 |
| waiting | retry exhaustion blocker | 注入 waiting 状态 + 不 block |
| done | 完成 task 后 prompt | allow（不阻止结束） |
| timeout/malformed | 注入坏 hook 输出/超时 | diagnostics 显式失败，不伪装 |

每样本：临时目录初始化（init + 项目级临时 hook 配置）→ 执行 → 收集
stdout/stderr/DB 写入检查 → 记录。只读探针（--version 等）自动跑；付费
prompt 调用前向用户列出命令与预计用途，获得确认后执行。

## 执行脚本

- 交互式确认后运行（Bash 中逐样本执行，输出重定向到记录）。
- 每样本记录：host/version、命令、exit code、输出摘要、DB 行数变化、
  结果（pass/fail + 限制）。
- 超时 60s；失败不重试不掩盖。

## 中断恢复样本

```text
1. 建卡 + run + 提交 execute result（task 处于 review 或下一节点）
2. 模拟中断（结束宿主调用，不写任何事实）
3. 新会话：Entry hook 注入 breadcrumb（或手动 tc status）
4. tc task next -> 继续节点 -> 完成
断言：中断不改变已有事实；恢复后 next 与中断前一致
```

## 记录文档

`development/host-smoke-2026-08.md`：每个样本一行/一段，含
`status: verified|documented|failed` + limitation；enforced/advisory 表。
记录是研究证据，不进入产品数据模型（沿用 host-feasibility.md 结论）。

## 边界

- 项目级临时配置（临时目录），不触碰 ~/.claude、~/.codex。
- 付费调用逐次确认；费用从用户现有登录/额度走，不新建资源。
- Codex 上游 502 等已知限制如实记录，不做 workaround。
