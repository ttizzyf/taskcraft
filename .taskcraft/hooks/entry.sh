#!/usr/bin/env bash
# Taskcraft managed entry hook gate (tc init --agent <host>).
cd "$(dirname "$0")/../.." || exit $?
# Resolve the CLI from the project, never from the installing machine: this
# wrapper is project content and must keep working after a clone. A PATH
# install is the fallback for projects that depend on a global tc.
if [ -f "dist/cli.js" ]; then
  taskcraft_output="$(node "dist/cli.js" state --breadcrumb)"
elif [ -f "node_modules/taskcraft/dist/cli.js" ]; then
  taskcraft_output="$(node "node_modules/taskcraft/dist/cli.js" state --breadcrumb)"
else
  taskcraft_output="$(tc state --breadcrumb)"
fi
taskcraft_status=$?
if [ "$taskcraft_status" -ne 0 ]; then
  exit "$taskcraft_status"
fi
if [ -n "$taskcraft_output" ]; then
  # A bare JSON object is interpreted as the host's hook control protocol.
  # Prefix the business breadcrumb so both Codex and Claude inject it as text.
  printf '%s\n' 'Taskcraft Entry context:' "$taskcraft_output"
fi
