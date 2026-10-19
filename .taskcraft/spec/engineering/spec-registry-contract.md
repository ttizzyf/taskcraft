# Spec Registry 实现合同

## 1. Scope / Trigger

修改 `.taskcraft/spec/index.json`、`src/spec/`、`tc init`、`tc spec`，或让新的
命令服务消费项目 Spec 时适用本合同。Registry 和正文是 Git-owned 输入；本模块负责
发现、校验、摘要与条目追加，但不打开或写入 Task Store，也不把候选自动提升为
Task binding。

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
parseSpecRegistryEntry(value: unknown): SpecRegistryEntry
appendSpecRegistryEntry(
  projectDir: string,
  entry: SpecRegistryEntry,
): AppendSpecRegistryEntryResult
appendSpecRegistryEntries(
  projectDir: string,
  entries: readonly SpecRegistryEntry[],
): AppendSpecRegistryEntriesResult
```

公开 CLI：

```text
tc init
tc spec list [--json]
tc spec check [--json]
tc spec resolve --path <repo-relative-path> [--path ...] [--json]
tc spec register --entries <json|@path|@-> [--json]
```

追加写入有两个入口，共用同一实现：`tc spec register --entries` 是批量入口，用于
老项目把已有文档一次性登记为初始 Spec；任务侧 `tc task spec sediment --register`
在沉淀时登记新 Spec。命令边界必须在任何追加之前完成全部只读校验——被拒绝的命令
不得改动 Registry 的字节。`tc spec list|check|resolve` 仍不打开或写入 Task Store，
也不写 Registry；`tc spec register` 只写 Registry，不打开 Task Store。

## 3. Contracts

- 固定 Registry 路径是 `.taskcraft/spec/index.json`，Schema version 是
  `tc-spec-registry/v1`；Schema 和 runtime validator 共用
  `src/contracts/spec-registry.schema.json`。
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
- `appendSpecRegistryEntries` 是 Registry 条目的唯一程序化写入路径（单条
  `appendSpecRegistryEntry` 是它的薄包装，`tc task spec sediment --register` 与
  `tc spec register` 都复用它）：只追加，永不覆盖。同 id 同内容为 no-op；同 id
  不同内容，或同 path 已属于另一个 id，一律拒绝而不是替换。
- 批量追加是一次读-校验-写：整批要么全部接受，要么 Registry 字节不变；整批都是
  重放时不重写文件。批内条目按提交顺序逐条判定，因此批内重复 id 也会被同一规则
  处理（同内容 no-op，不同内容拒绝）。
- 追加必须复用同一套校验器（`parseRegistry`、`validateUniqueRegistryFields`、
  `validateRegistryPaths`、`resolveSpecDocument`），不得另写第二套解释；写出的
  必须是被重新解析校验过的字节。
- 追加前正文必须已经是 containment 内的可读常规文件；Registry 不登记承诺。
- 条目身份是 `id` 与 `path`，不是正文 digest。正文由 Agent 书写，重复登记同一条目
  必须幂等。
- `index.json` 是整文件读改写，替换必须原子（临时文件 + rename），失败不得留下
  截断的 Registry。

## 4. Validation & Error Matrix

| 条件 | 稳定错误 | 影响与处理 |
| --- | --- | --- |
| Registry JSON/UTF-8/Schema/唯一性/glob 非法 | `TC_SPEC_REGISTRY_INVALID` | 修正 Registry 后运行 `tc spec check` |
| Registry 或正文缺失 | `TC_SPEC_NOT_FOUND` | 用 `tc init` 创建缺失 Registry；正文应恢复或移除条目 |
| 项目、路径、文件类型、可读性、containment 或读取稳定性非法 | `TC_SPEC_PATH_INVALID` | 修正路径/权限/文件，再运行 `tc spec check` |
| 追加：同 id 不同内容，或同 path 已属于另一 id | `TC_SPEC_REGISTRY_INVALID` | 保留原 Registry 字节；改用新 id 或修正条目，不得覆盖 |
| 追加：正文缺失、类型非法或越界 | `TC_SPEC_NOT_FOUND` / `TC_SPEC_PATH_INVALID` | 先写好正文再登记；Registry 不登记不存在的正文 |
| 追加：`index.json` 无法原子替换 | `TC_SPEC_PATH_INVALID` | 原 Registry 字节保留，修正权限/路径后重试 |
| 批量追加：批内任一条目冲突或正文缺失 | `TC_SPEC_REGISTRY_INVALID` / `TC_SPEC_NOT_FOUND` | 整批不落盘，Registry 字节不变；修正后重试 |

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
- Good：Agent 先写好正文，再由 `tc task spec sediment --register` 登记；同一条目
  重复登记返回 no-op，重复运行不产生第二个条目。
- Good：老项目把已有文档列成一份 entries 数组，用 `tc spec register --entries`
  一次原子登记；重复运行同一份清单是 no-op，中途任何一条冲突则整批不落盘。
- Bad：为了让新 Spec 可发现而手工重排 `index.json`，或用第二个解析器写入条目；
  两者都绕过了唯一校验入口，必须在 Review 中拒绝。

## 6. Tests Required

- `tests/spec/`：Schema/唯一性、domain authority、canonical paths、glob、missing、
  directory/unreadable、symlink containment、非法 UTF-8、摘要和 deprecated 行为。
- `tests/cli/spec.test.ts`：list/check/resolve 的文本与 JSON、稳定错误/退出码、候选只读。
- `tests/cli/init.test.ts`：write-if-absent、已有 bytes 保留、越界 `.taskcraft` 在 Store
  写入前失败。
- `tests/contracts/schemas.test.ts`：fixture 和 runtime 使用同一 strict Ajv Schema。
- `tests/spec/registry.test.ts` 与 `tests/cli/spec-sediment.test.ts`：条目追加、同条目
  重放 no-op、同 id 不同内容与同 path 另一 id 被拒、正文缺失、原子替换后字节完整，
  以及被拒绝的命令（例如任务尚未 `done`）之后 `index.json` 字节逐字不变。
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

追加路径同样只能有一条实现。

### Wrong

```ts
// 直接拼字符串改 index.json，绕过唯一校验入口，且整文件写入不是原子的。
const document = JSON.parse(readFileSync(registryPath, "utf8"));
writeFileSync(
  registryPath,
  JSON.stringify({ ...document, specs: [...document.specs, entry] }),
);
```

### Correct

```ts
appendSpecRegistryEntry(projectDir, parseSpecRegistryEntry(entry));
// 复用 Registry 解析器与校验器；同 id 同内容为 no-op，冲突则拒绝。
```
