#!/bin/sh
set -eu

subject=${1-}
case "$subject" in
  orchestrator)
    server_name=sbOrchestrator
    ;;
  worker)
    server_name=sbWorker
    ;;
  *)
    echo "Expected subject: orchestrator or worker" >&2
    exit 1
    ;;
esac

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_root=$(CDPATH= cd -- "$script_dir/../../.." && pwd)
project_dir="$repo_root/fixtures/opencode/project"
runtime_dir="$project_dir/.runtime"

exec node "$repo_root/dist/server.js" \
  --policy "$runtime_dir/subject-broker.yaml" \
  --subject "$subject" \
  --server-name "$server_name" \
  --audit "$runtime_dir/audit-$subject.jsonl" \
  --max-bytes 1048576
