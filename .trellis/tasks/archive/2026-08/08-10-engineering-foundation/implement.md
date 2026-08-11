# Implementation Plan: Taskcraft Engineering Foundation

## Phase 1: Package And Quality Gates

- [x] 更新 `.gitignore`，加入 `node_modules/`、`dist/`、`coverage/` 和
  `*.tsbuildinfo`。
- [x] 创建 ESM/private `package.json`、pnpm 10 锁文件、TypeScript 6 配置和
  NodeNext build 配置。
- [x] 配置 ESLint 10 + typescript-eslint 8、Prettier 3、Vitest 4/60 秒超时。
- [x] 实现 `max-lines` 400/401 行内存正负测试，确认源码与测试没有豁免。
- [x] 建立 test/typecheck/lint/format:check/build/check 命令并运行工具链检查。

Rollback point: 只涉及工程配置和锁文件，可在进入 Store 前独立回退。

## Phase 2: CLI Shell

- [x] 使用 Commander 15 创建 `tc` 根入口，只支持 `--help` 和 `--version`。
- [x] 用 package version 作为唯一版本来源，不复制版本常量。
- [x] 添加构建后 help/version smoke；确认没有业务子命令。

Rollback point: CLI 壳不被 Store 或 contract helper 反向依赖。

## Phase 3: Store Foundation And Migrations

- [x] 实现 better-sqlite3 唯一连接入口和四项 connection policy。
- [x] 实现 migration 文件发现、名称/version 校验、SHA-256 和 ledger 校验。
- [x] 实现逐 migration `BEGIN IMMEDIATE`、commit/rollback 和一个最小 typed
  `TC_STORE_*` 错误边界。
- [x] 从 `storage.sql` 创建不含 PRAGMA 的 `0001_initial.sql`。
- [x] 测试空库、重复运行、duplicate、missing file、checksum drift、失败回滚、
  snapshot 一致性和 `foreign_key_check`。

Rollback point: migration 与连接层一起回退；不得在 `storage.sql` 加兼容分支。

## Phase 4: JSON Contracts

- [x] 实现明确路径的 JSON loader 和 Ajv 2020 strict validator factory。
- [x] 编译 Lifecycle/Breadcrumb Schema，覆盖代表性 valid/invalid instance。
- [x] 解析现有 fixture，明确 `l2-task.fixture.json` 没有直接对应 Schema。
- [x] 保留 JSON parse、strict compile 和 validation errors，不增加 fallback。

## Phase 5: Integration And Documentation

- [x] 在 README 记录安装、检查、测试、构建和 CLI smoke 命令。
- [x] 运行全量 `pnpm check`、frozen install 和构建后 CLI smoke。
- [x] 检查没有业务层空壳、Taskcraft Hook、Adapter、Web 或远程 CI 混入。
- [x] 按 Trellis check 完成 diff 审阅、spec 更新判断、提交和归档。

## Validation

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm lint
pnpm format:check
pnpm build
node dist/cli.js --help
node dist/cli.js --version
pnpm check
pnpm install --frozen-lockfile
git diff --check
python3 ./.trellis/scripts/task.py validate .trellis/tasks/08-10-engineering-foundation
```

最后一次 `pnpm test` 使用 Vitest 的 60 秒硬超时。安装、native addon 构建或测试
失败必须保留原始错误；不得删除依赖、跳过测试或加入伪成功路径来通过检查。

## Final Review

- [ ] 没有重复版本来源、数据库入口或 Schema loader。
- [ ] 没有 ORM、repository interface、bundler、workspace 或自定义 lint 插件。
- [ ] migration rollback 不吞原始失败，ledger 与 schema 不出现部分写入。
- [ ] tests 删除自身临时目录，不读取用户主目录或宿主凭据。
- [ ] 所有新增 JS/TS 文件不超过 400 个有效行。
- [ ] Task 02 可以直接导入 Store/migration/Schema helper，但 Task 01 没有实现业务。
