#!/bin/sh
set -eu

case_name=${1-}
case "$case_name" in
  c1-parent-control|c2-default-child|c3-restricted-worker|c4-restricted-privileged-first)
    ;;
  *)
    echo "Expected one case name: c1-parent-control, c2-default-child, c3-restricted-worker, or c4-restricted-privileged-first" >&2
    exit 1
    ;;
esac

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
project_dir=$(CDPATH= cd -- "$script_dir/../project" && pwd)
runtime_dir="$project_dir/.runtime"
case_marker="$runtime_dir/current-case"

if ! test -f "$runtime_dir/subject-broker.yaml"; then
  echo "Run prepare-fixture.sh first." >&2
  exit 1
fi

if test -e "$case_marker"; then
  echo "A case is already active. Capture it before preparing another case." >&2
  exit 1
fi

for audit_path in "$runtime_dir/audit-orchestrator.jsonl" "$runtime_dir/audit-worker.jsonl"; do
  if test -s "$audit_path"; then
    echo "Refusing to reuse non-empty audit file: $audit_path" >&2
    exit 1
  fi
done

printf '%s\n' "$case_name" > "$case_marker"
printf '%s\n' \
  "Prepared $case_name." \
  "Restart sbOrchestrator and sbWorker in VS Code, then run only this case."
