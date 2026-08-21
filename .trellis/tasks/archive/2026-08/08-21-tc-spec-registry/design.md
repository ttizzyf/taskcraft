# Design

实现固定 Registry 入口 `.taskcraft/spec/index.json` 和一个无 SQLite 依赖的
`src/spec/` 服务。服务接收显式 `projectDir`，先用 Ajv strict 验证，再用 realpath
验证每个正文仍位于仓库内，最后返回不可变 DTO 与 SHA-256。`appliesTo` 仅用于候选
发现，不能自动形成 Task binding。

`tc init` 只在文件不存在时写入空 Registry；已有文件不解析后覆盖。`tc spec check`
执行完整解析，`list` 消费同一 DTO，`resolve` 对调用方给出的 repo-relative paths
匹配 active entries。所有错误映射到 `TaskcraftError`，不使用 silent fallback。

Schema 同时放入 `development/contracts/` 并由 production validator 与 contract tests
共享。Registry 正文和索引由 Git 管理，Task Store 不参与本模块。
