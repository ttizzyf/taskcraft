# Spec Registry 实现合同

## 1. Scope / Trigger

修改 `.taskcraft/spec/index.json`、`src/spec/`、`tc init`、`tc spec`，或让新的
命令服务消费项目 Spec 时适用本合同。Registry 和正文是 Git-owned 输入；本模块只
负责发现、校验和摘要，不打开或写入 Task Store，也不把候选自动提升为 Task binding。

## 2. Signatures

公开 TypeScript 入口统一从 `src/spec/index.ts` 导入：

```ts
initializeSpecRegistry(projectDir: string): boolean
loadSpecRegistry(projectDir: string): LoadedSpecRegistry
checkSpecRegistry(registry: LoadedSpecRegistry): SpecCheckResult
resolveSpecCandidates(
  registry: LoadedSpecRegistry,
  paths: readonly string[],
): SpecResolutionResult
```

公开 CLI：

```text
tc init
tc spec list [--json]
tc spec check [--json]
tc spec resolve --path <repo-relative-path> [--path ...] [--json]
```

## 3. Contracts

- 固定 Registry 路径是 `.taskcraft/spec/index.json`，Schema version 是
  `tc-spec-registry/v1`；Schema 和 runtime validator 共用
  `development/contracts/spec-registry.schema.json`。
- 条目使用判别联合类型：`engineering` 的 `authority` 可选，`domain` 必须具有
  非空 `authority`。`id` 和 `path` 全局唯一，unknown fields 拒绝。
- `path` 和 `appliesTo` 必须是 canonical repo-relative 值；绝对路径、反斜杠、空
  segment、`.`、`..` 和 Windows drive-relative 值拒绝。
- Registry 和正文必须解析到 project realpath 内的可读常规文件。读取使用同一个
  file descriptor，打开后复核 realpath/inode，并在读取前后复核文件元数据；摘要
  是正文原始 bytes 的 SHA-256。
- `resolveSpecCandidates` 只匹配 `active` 条目的 `appliesTo` glob。结果是候选 DTO，
  不修改 Registry、正文或 SQLite。
- `initializeSpecRegistry` 只在路径完全不存在时写入空 Registry；已有正常文件、坏
  文件或 symlink 均不覆盖。目录 containment 校验必须发生在任何 Registry 或 Store
  写入之前。

## 4. Validation & Error Matrix

| 条件 | 稳定错误 | 影响与处理 |
| --- | --- | --- |
| Registry JSON/UTF-8/Schema/唯一性/glob 非法 | `TC_SPEC_REGISTRY_INVALID` | 修正 Registry 后运行 `tc spec check` |
| Registry 或正文缺失 | `TC_SPEC_NOT_FOUND` | 用 `tc init` 创建缺失 Registry；正文应恢复或移除条目 |
| 项目、路径、文件类型、可读性、containment 或读取稳定性非法 | `TC_SPEC_PATH_INVALID` | 修正路径/权限/文件，再运行 `tc spec check` |

失败不得降级为空 Registry、空候选或成功退出。错误通过 `TaskcraftError` 提供
problem、impact、remediation 和必要 context。

## 5. Good / Base / Bad Cases

- Good：active engineering 条目引用仓库内 Markdown，`resolve` 返回带当前 digest 的
  候选；文本与 JSON 只是同一 DTO 的不同渲染。
- Base：空 Registry 合法；deprecated 条目仍完整校验、读取和摘要，但不参与候选匹配。
- Bad：`.taskcraft` 或正文父目录通过 symlink 指向仓库外；命令必须在写 Store 或读取
  越界正文前失败。
- Bad：domain 条目没有 authority，或正文缺失；不得伪造 authority、跳过正文或建议
  仅设为 deprecated 来绕过完整校验。

## 6. Tests Required

- `tests/spec/`：Schema/唯一性、domain authority、canonical paths、glob、missing、
  directory/unreadable、symlink containment、非法 UTF-8、摘要和 deprecated 行为。
- `tests/cli/spec.test.ts`：list/check/resolve 的文本与 JSON、稳定错误/退出码、候选只读。
- `tests/cli/init.test.ts`：write-if-absent、已有 bytes 保留、越界 `.taskcraft` 在 Store
  写入前失败。
- `tests/contracts/schemas.test.ts`：fixture 和 runtime 使用同一 strict Ajv Schema。
- 修改本边界后至少运行上述定向测试、typecheck、lint、format check 和 build。

## 7. Wrong vs Correct

### Wrong

```ts
// 每个消费者自行读 Registry，或把路径匹配结果直接写成 binding。
const registry = JSON.parse(readFileSync(".taskcraft/spec/index.json", "utf8"));
bind(registry.specs.filter((spec) => matches(spec, changedPath)));
```

这会复制验证逻辑，并把“候选发现”错误升级为语义选择。

### Correct

```ts
const registry = loadSpecRegistry(projectDir);
const result = resolveSpecCandidates(registry, changedPaths);
// Agent/上层规划显式确认候选；本模块不写 Task Store。
```

所有消费者复用解析 DTO；后续 binding 逻辑只能接收已经显式确认的条目。
