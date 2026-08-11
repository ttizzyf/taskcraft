# Task 01 工具链兼容性记录

检查日期：2026-08-10。本文只保存本次规划证据，实际 patch 版本由
`pnpm-lock.yaml` 冻结。

## npm Metadata

| 包 | 当前候选 | Node/peer 结论 |
| --- | --- | --- |
| Commander.js | 15.0.0 | Node >=22.12，支持 Node 24 |
| ESLint | 10.8.1 | 支持 Node >=24 |
| typescript-eslint | 8.66.0 | 支持 ESLint 10；TypeScript >=4.8.4 且 <6.1 |
| TypeScript | 6.0.3 | 与 typescript-eslint peer range 匹配；不选 latest 7.0.2 |
| Prettier | 3.9.6 | 支持 Node >=14 |
| better-sqlite3 | 12.11.1 | engines 包含 Node 24 |
| Ajv | 8.20.0 | 保持 ADR 选定的 8.x |
| Vitest | 4.1.10 | 支持 Node >=24 |
| @types/better-sqlite3 | 9.6.0 | 提供 TypeScript 声明 |

## Official Usage Checks

- Commander 官方文档使用 `import { Command } from "commander"`；异步 action 使用
  `parseAsync()`。Task 01 只有根命令，但保留该入口以免 Task 02 更换启动方式。
- ESLint 10 官方 `max-lines` 支持 `max`、`skipBlankLines` 和 `skipComments`，不需要
  插件。
- ESLint flat config 的 ignore object 应单独声明；Task 01 使用集中 ignore，不在
  每个规则块复制排除路径。

## Planning Consequence

使用当前兼容 major：TypeScript 6、ESLint 10、typescript-eslint 8、Commander 15。
不使用 TypeScript 7，不自制行数脚本，也不为 CLI 引入 oclif/yargs 等第二框架。
