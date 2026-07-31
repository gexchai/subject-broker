#!/bin/sh
set -eu

case_name=${1-}
case "$case_name" in
  c1-parent-control|c2-default-child|c3-restricted-worker|c4-restricted-privileged-first)
    ;;
  *)
    echo "Unknown case name: $case_name" >&2
    exit 1
    ;;
esac

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_root=$(CDPATH= cd -- "$script_dir/../../.." && pwd)
project_dir="$repo_root/fixtures/vscode-copilot/project"
runtime_dir="$project_dir/.runtime"
case_marker="$runtime_dir/current-case"
result_dir="$repo_root/results/vscode-copilot-confirmation/$case_name"

if ! test -f "$case_marker" || test "$(cat "$case_marker")" != "$case_name"; then
  echo "The active case marker does not match $case_name." >&2
  exit 1
fi

if test -e "$result_dir"; then
  echo "Refusing to overwrite existing result directory: $result_dir" >&2
  exit 1
fi

mkdir -p "$result_dir"
for subject in orchestrator worker; do
  source_path="$runtime_dir/audit-$subject.jsonl"
  destination_path="$result_dir/audit-$subject.jsonl"
  if test -f "$source_path"; then
    mv "$source_path" "$destination_path"
  else
    : > "$destination_path"
  fi
done

mv "$case_marker" "$result_dir/case.txt"

printf '%s\n' \
  "Broker evidence captured in:" \
  "  $result_dir" \
  "Export Chat JSON as chat.json and Agent Debug OTLP JSON as agent-debug.otlp.json into that directory."
