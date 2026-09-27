# Fixture 版本说明

`spec-registry.fixture.json` 是 `tc-spec-registry/v1` 的 Schema 合同样本，只验证
Registry 元数据形状；其中的 Markdown 路径不表示 fixture loader 会读取或复制正文。
正文安全解析、project realpath containment 和 SHA-256 合同由 `tests/spec/` 覆盖。

本目录中的 `l3-pass`、`l3-feasibility-blocked`、`l3-single-child`、
`l3-waiting-decision`、`l3-conflict`、`l3-stale` 与 L3 fact fixtures 保存的是
历史 `tc-l3/1` 单任务图，用于证明 migration 0002 之后旧 revision 仍可读取、投影
和查询。它们不是当前 `tc-l3/2` 模块化执行模型的示例，不能据此声称 L3 仍只有
一个父级 execute 或信息性 child。

`tc-l3/2` 涉及多个 tasks、planning/execution revisions 和 normalized relation
tables。当前可执行样本由 reducer/CLI 在迁移后的真实 SQLite 中生成，覆盖位置：

- `tests/core/projector.l3.test.ts`：planning、modules execution、single execution、
  inherited L1/L2 child graph；
- `tests/core/reducer.l3-plan.test.ts`：原子物化、waiting/resume、replan、reuse 和
  `not_required` 历史；
- `tests/cli/l3.test.ts`：公开 CLI 的 modules、single、child→parent replan 和 done；
- `.taskcraft/spec/history/l3-sample.md`：可复制的公开 CLI modules/single 命令序列。

在 fixture loader 能原样导入 0002 的 relation tables 前，不要手写一个只包含部分
relation 的“v2 fixture”；那会制造比 reducer 生成事实更弱的第二合同。
