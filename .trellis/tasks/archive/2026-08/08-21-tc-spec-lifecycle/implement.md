# Implementation

1. 新增 migration 0003 并同步 storage contract/query types。
2. 建立 binding 读写 helper 和不可变/来源约束测试。
3. 扩展 task new 及 L1/L2/L3 compiler versions。
4. 扩展 L2 Frame、L3 Plan schema 和 accepted transaction。
5. 实现 child inheritance/reuse Spec 等价。
6. 实现 drift check 与 `task spec refresh`，提取共享 replan primitive。
7. 覆盖 CAS、rollback、旧 revision、L1/L2/L3 公共 reducer/CLI 测试。

验证：

```bash
pnpm vitest run tests/store tests/core --testTimeout=60000
pnpm typecheck
pnpm lint
pnpm format:check
pnpm build
```
