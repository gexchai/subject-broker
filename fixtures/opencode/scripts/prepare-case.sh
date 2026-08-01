#!/bin/sh
set -eu

case_name=${1-}
case "$case_name" in
  c1-parent-control|c2-default-child|c3-restricted-worker|c4-restricted-privileged-first|c5-restricted-injection|c6-restricted-nested|c7-restricted-nested-depth2)
    ;;
  *)
    echo "Unknown case name: $case_name" >&2
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
for path in \
  "$runtime_dir/audit-orchestrator.jsonl" \
  "$runtime_dir/audit-worker.jsonl" \
  "$runtime_dir/opencode-events.jsonl" \
  "$runtime_dir/opencode-stderr.log"; do
  if test -s "$path"; then
    echo "Refusing to reuse non-empty evidence file: $path" >&2
    exit 1
  fi
done

printf '%s\n' "$case_name" > "$case_marker"
printf '%s\n' "Prepared $case_name."
