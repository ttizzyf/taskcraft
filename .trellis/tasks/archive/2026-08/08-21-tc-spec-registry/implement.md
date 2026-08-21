# Implementation

1. 增加 Registry JSON Schema、fixtures、typed DTO 和 validator。
2. 实现安全 Registry loader、文件摘要与 candidate resolver。
3. 扩展 init 的 write-if-absent 行为。
4. 注册 `tc spec list|check|resolve` 并复用 command-result renderer。
5. 增加稳定错误和 unit/CLI/contract tests。
6. 同步 product/architecture/CLI 中的 Registry 边界。

验证：

```bash
pnpm vitest run tests/spec tests/cli/spec.test.ts tests/cli/init.test.ts --testTimeout=60000
pnpm typecheck
pnpm lint
pnpm format:check
pnpm build
```
