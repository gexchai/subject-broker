#!/bin/sh
set -eu

case_name=${1-}
model=${2-${OPENCODE_TEST_MODEL-}}
opencode_bin=${OPENCODE_BIN-opencode}

case "$case_name" in
  c1-parent-control)
    agent=sb-direct-parent
    ;;
  c2-default-child)
    agent=sb-unrestricted-parent
    ;;
  c3-restricted-worker|c4-restricted-privileged-first|c5-restricted-injection)
    agent=sb-parent
    ;;
  c6-restricted-nested|c7-restricted-nested-depth2)
    agent=sb-nesting-parent
    ;;
  *)
    echo "Unknown case name: $case_name" >&2
    exit 1
    ;;
esac

if test -z "$model"; then
  echo "Provide a provider/model as argument 2 or OPENCODE_TEST_MODEL." >&2
  exit 1
fi

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_root=$(CDPATH= cd -- "$script_dir/../../.." && pwd)
project_dir="$repo_root/fixtures/opencode/project"
runtime_dir="$project_dir/.runtime"
prompt_path="$repo_root/fixtures/opencode/prompts/$case_name.txt"

if ! test -f "$runtime_dir/current-case" || test "$(cat "$runtime_dir/current-case")" != "$case_name"; then
  echo "The active case marker does not match $case_name." >&2
  exit 1
fi
if ! test -x "$opencode_bin" && ! command -v "$opencode_bin" >/dev/null 2>&1; then
  echo "OpenCode executable not found: $opencode_bin" >&2
  exit 1
fi

export XDG_CONFIG_HOME="$runtime_dir/xdg/config"
export XDG_DATA_HOME="$runtime_dir/xdg/data"
export XDG_CACHE_HOME="$runtime_dir/xdg/cache"
export XDG_STATE_HOME="$runtime_dir/xdg/state"

if test "$case_name" = "c7-restricted-nested-depth2"; then
  export OPENCODE_CONFIG_CONTENT='{"subagent_depth":2}'
fi

"$opencode_bin" run \
  --pure \
  --auto \
  --format json \
  --dir "$project_dir" \
  --agent "$agent" \
  --model "$model" \
  --title "SubjectBroker $case_name" \
  "$(cat "$prompt_path")" \
  > "$runtime_dir/opencode-events.jsonl" \
  2> "$runtime_dir/opencode-stderr.log"
