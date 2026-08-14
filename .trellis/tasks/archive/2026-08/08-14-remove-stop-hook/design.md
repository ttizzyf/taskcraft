# Design: Entry-only hooks and agent-driven continuation

## 1. Decision

Taskcraft will remove Stop Hook completely for both Codex and Claude. Task
continuity remains a task-level property, not a turn-level enforcement policy:

```text
Task Store facts + command result next + Node Brief
  → Agent continues while direction is clear and safe
  → typed waiting when input/decision/dependency is required
  → Entry Hook restores the task in a later turn/session
```

An active task may outlive any individual Agent turn. Only reducer facts and
obligations determine `done`; ending a turn changes no Taskcraft state.

This is a pre-release clean break. No legacy Stop cleanup, compatibility alias,
old persisted result mapping, or no-op wrapper will be implemented.

## 2. Public contract changes

### 2.1 CLI

- Replace `tc agent test-hook` with `tc agent test-entry-hook`.
- `tc init --agent codex|claude` installs only
  `.taskcraft/hooks/entry.sh` and registers only SessionStart.
- `tc enable` reports and verifies Entry behavior only.
- Capabilities display “entry hook test” with `ok|failed`, timestamp, host
  version, and optional failure. The `enforced/not enforced` label disappears.

### 2.2 Adapter types

- Remove `"stop"` from `CapabilityName`.
- Change host config builders and `HookCommands` to an Entry command only.
- Rename `HostAdapter.testHook` to `testEntryHook`.
- Reduce `HookTestInput` to the installed Entry wrapper, timeout, prompt, and
  optional host gate.
- Reduce `HookTestResult` to `ok`, `entryInjected`, `testedAt`, optional
  `failure`, and optional output `sample`.

### 2.3 Persisted config and Watch API

Use one Entry-specific source:

```ts
interface EntryHookTestRecord {
  testedAt: string;
  version: string | null;
  ok: boolean;
  failure?: string;
}

TaskcraftConfig.entryHookTests?: Record<string, EntryHookTestRecord>;
WatchRuntime.entryHookTests: Record<string, EntryHookTestRecord>;
```

Remove `hookTests`, `HookTestRecord`, and `enforced`. There is no compatibility
reader because no production data contract exists yet.

### 2.4 Diagnostics

Entry diagnostics check:

1. managed `entry.sh` exists and references a built gate artifact;
2. Codex/Claude project configuration registers SessionStart → `entry.sh`;
3. a field-test record exists and its result is successful;
4. wrapper/gate modification time does not postdate the record;
5. current host version matches the tested version.

Rename Watch-local codes to Entry-specific names:

- `TC_ENTRY_HOOK_TEST_MISSING`
- `TC_ENTRY_HOOK_REGISTRATION_INVALID`
- `TC_ENTRY_HOOK_VERSION_DRIFT`

Core `TC_ADAPTER_HOOK_INSTALL_FAILED` and
`TC_ADAPTER_HOOK_TEST_FAILED` remain valid generic Adapter errors.

## 3. Runtime deletion boundary

Delete:

- `src/hooks/stop.ts`
- `tests/hooks/stop.test.ts`
- stop wrapper generation and protocol branching
- Codex `hooks.Stop` and Claude `hooks.Stop` builders/serializers
- stop/loop execution in the field-test runner
- Stop capability probes, CLI fields, Watch fields, and diagnostics

Do not replace them with an allow-only Hook. A no-op wrapper would preserve a
misleading runtime surface and keep host-specific complexity alive.

## 4. Documentation and decision history

- Add ADR 0009, superseding only the Stop/forced-continuation portion of ADR
  0004. ADR 0004 remains historical for host capability and run correlation.
- Rewrite normative `lifecycle`, `architecture`, `product`, and `cli` specs to
  make Entry + task facts the sole continuation contract.
- Update README, roadmap, migration runbook, Task 07 status, and handoffs to
  remove Stop as a release gate.
- Preserve research and smoke evidence as historical records; add an explicit
  supersession note instead of deleting past observations.

## 5. Compatibility, rollout, and rollback

There is no compatibility rollout. Fresh output is the only supported state.
Existing temporary dogfood directories may be recreated.

Rollback is Git revert of this task. No SQLite migration or irreversible user
data rewrite is involved.

## 6. Risks and controls

- **Agent stops prematurely:** preserve explicit `next`, Node Brief, Entry
  recovery, and documentation instructing continuous progress when safe.
- **Agent pursues an invalid objective:** make `waiting` and blocker reporting
  an expected successful boundary, not a failure to continue.
- **Partial removal:** use repository-wide scans across source, tests, Watch,
  generated host config text, normative docs, and status docs.
- **Historical drift:** do not rewrite old experiments; label them historical
  and point to ADR 0009/current specs.
- **Field-test false success:** keep the unique active breadcrumb, registration,
  path, trust/feature, timeout, and real-host output checks.
