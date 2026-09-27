#!/usr/bin/env bash
# Taskcraft managed entry hook gate (tc init --agent <host>).
cd "$(dirname "$0")/../.." || exit $?
taskcraft_output="$(node "D:/a_project_flie/taskcraft/dist/cli.js" state --breadcrumb)"
taskcraft_status=$?
if [ "$taskcraft_status" -ne 0 ]; then
  exit "$taskcraft_status"
fi
if [ -n "$taskcraft_output" ]; then
  # A bare JSON object is interpreted as the host's hook control protocol.
  # Prefix the business breadcrumb so both Codex and Claude inject it as text.
  printf '%s
' 'Taskcraft Entry context:' "$taskcraft_output"
fi
