# 实施设计

## 1. Claude Entry

Claude adapter启用 `--output-format stream-json --verbose`，继续加载实际项目注册。共享runner保留统一超时、退出码和持久化；宿主专属解析只在Claude边界解释结构化事件。

以成功的SessionStart Hook响应中有效breadcrumb为注入证据，不能仅匹配模型回复中的字符串。复用既有breadcrumb合同校验，不扩展为第二套JSON schema。损坏事件、失败Hook、模型终态错误、宿主非零/超时保持显式失败。Codex路径保持既有宿主格式，不能用Claude解析器强套。

## 2. 冷启动读取

复用 `task show` 作为读取入口，新增当前已领取节点的可空 `nodeBrief` 数据并在文本模式渲染；不新增CLI命令或改变breadcrumb schema，既有detailCommand自然获得恢复所需内容。

从当前revision的projector/attempt事实解析正在执行的节点，复用现有Node Brief构造器。若构造器位置妨碍查询层复用，可将纯构造逻辑移至core共享模块并统一引用，不复制实现。规范drift复用现有只读Spec查询；读取不能变为领取/校验写入入口。

Review节点从持久化Review link解析被审attempt及purpose，不能调用review start来读取卡；没有已领取节点时返回null，仍由next引导正常领取。L3 root与child定位保持已有投影规则，查询具体child的卡，不伪造parent执行卡。

## 3. 校验错误

在 `lifecycle-result` 使用同一缓存validator取得校验结果与错误详情；doctor等布尔消费者可以保留薄包装，但不能重复编译或定义schema。将instancePath、keyword、missing/additional property等必要信息格式化进入现有problem字符串，不回显用户提交值；保持Command Result错误信封结构。

所有使用持久化节点schema的结果提交路径共用错误表达，remediation直接指向 `tc task show <id> --json` 取得当前卡，必要时带对应run/node说明。错误码不变，旧revision仍按原schema判断。禁止只修execute留下frame/plan/record等重复逻辑。

## 4. 回归与重新测评

先验证结构化事件、纯查询、错误诊断、幂等性及跨revision合同，再构建隔离运行版本。不改package.json/vitest.config.ts/evals目录来适配本任务。

真实测试继续使用2026-09-09的CSV公开需求与固定验收。临时运行器先用合成事件验证字符串/对象message、权限拒绝和异常finally停止；普通node项目验证脚本纳入合理工具许可，控制材料在被测项目外，实际隔离边界写入报告。

Entry与L2操作员可并行；操作员不是被测Agent。L2首会话在真实execute领取且源码首次Edit后中断，冷启动只收到普通继续请求。真实盲审若无自然返工，按前次批准方式另建人工缺陷样本，不告诉reviewer缺陷位置或要求假判失败。另一个新会话修复，再独立复审和收尾。

显式选择DeepSeek并核对实际model，公共命令通过临时进程/项目model设置；不修改全局。公共Entry60秒；每个L2会话10分钟，本轮最多6个有效开发/审核会话。环境或控制器异常单独记载，不隐性循环直到通过。

报告新增 `development/evaluations/claude-entry-l2-recovery-2026-09-10.md`，保留前次报告不覆盖。报告包括源码版本/差异摘要、提示词、实际工具许可、模型、终态和干预，清理临时产物但不删除用户原有宿主历史。

## 5. 范围与风险

主要影响adapters、共享Node Brief查询、task show/render、结果校验及对应测试/规范。新增task show字段应检查共享DTO/Watch消费者，但不额外开发Watch界面。

当前工作区存在用户并行evals修改，实施前保存涉及文件基线，冲突时只合并本任务必要改动。已被用户修改的Entry合同需增量编辑。测评成功不等于完整狗粮化迁移验收通过。
