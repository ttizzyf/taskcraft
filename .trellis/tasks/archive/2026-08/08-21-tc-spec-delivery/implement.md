# Implementation

1. 扩展 Node Brief DTO/renderers/adapter conformance 和 Review Brief。
2. 实现新 Record schema、Spec Impact reducer/obligation/query。
3. 扩展 task show、CLI render 与 Watch DTO/frontend。
4. 扩展 doctor/diagnostics，保持 old compiler compatibility。
5. 增加 L1/L2/L3 public CLI、adapter、Watch smoke 回归。
6. 同步产品合同、README、runbook 和 `.trellis/spec`。

验证：

```bash
pnpm test -- --testTimeout=60000
pnpm typecheck
pnpm lint
pnpm format:check
pnpm build
pnpm smoke:watch
pnpm check
```
