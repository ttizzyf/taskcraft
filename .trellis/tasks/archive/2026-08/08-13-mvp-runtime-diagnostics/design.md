# Design: runtime observation & diagnostics

## Reducer / 命令

```ts
runAttach(db, { taskId, expectedRevision?, nodeId, hostRunId, hostSessionId?,
                host, observationStatus? })
// withTransaction：校验 attempt 存在且属当前 revision → insert agent_runs
//   （id 生成沿用全局模式）→ event observation.attached
runStatus(db, { taskId })  // 只读：attempts + agent_runs 关联展示
```

- agent_runs 写入走 reducer（唯一写入口）；`attachObservation` adapter 方法
  改为调用 runAttach 逻辑（不重复实现）。

## config.hookTests

```json
{ "takeOver": "ask", "agents": ["claude"],
  "hookTests": { "claude": { "testedAt": "...", "version": "2.1.220",
    "ok": true, "enforced": true, "failure": null } } }
```

- 写：test-hook（C）；读：`tc agent capabilities`（附最近测试行）与 Watch
  diagnostics（routes 读取同文件，无第二套推导）。

## Watch 同源

- Runtime API：getAgentRuns（真实表数据）+ config.hookTests 摘要。
- Diagnostics API：hook 失效/未注册/版本漂移基于安装状态 + hookTests
  比对（不重复现场检测）。
- 前端 Runtime/Diagnostics 面板只渲染 API 返回。

## Tests

- reducer.run-attach.test.ts：写行/引用校验/CAS/零写入。
- CLI：attach → status 展示；attach finished → task 投影不变。
- Watch：API 数据来自真实 attach 写入（非 fixture）。
