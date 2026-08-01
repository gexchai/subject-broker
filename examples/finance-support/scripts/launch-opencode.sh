#!/bin/sh
set -eu

subject_id=${1-}
case "$subject_id" in
  parent|finance-agent|support-agent)
    ;;
  *)
    echo "Choose parent, finance-agent, or support-agent." >&2
    exit 1
    ;;
esac
shift

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
example_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
repo_root=$(CDPATH= cd -- "$example_dir/../.." && pwd)
runtime_dir="$example_dir/.runtime"
policy_path="$runtime_dir/subject-broker.yaml"
audit_path="$runtime_dir/audit/$subject_id.jsonl"
workspace="$example_dir/workspace"
opencode_bin=${OPENCODE_BIN-opencode}

if ! test -f "$policy_path"; then
  "$script_dir/prepare.sh"
fi

npm run build --prefix "$repo_root"
node "$repo_root/dist/opencode-adapter.js" \
  --subject "$subject_id" \
  --policy "$policy_path" \
  --audit "$audit_path" \
  --workspace "$workspace" \
  --opencode "$opencode_bin" \
  -- "$@"
