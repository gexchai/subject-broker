#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_root=$(CDPATH= cd -- "$script_dir/../../.." && pwd)
project_dir="$repo_root/fixtures/opencode/project"
runtime_dir="$project_dir/.runtime"
storage_root="/private/tmp/subject-broker-opencode/protected-storage"
protected_path="$storage_root/secret.txt"

npm --prefix "$repo_root" run build

mkdir -p \
  "$runtime_dir" \
  "$runtime_dir/xdg/config" \
  "$runtime_dir/xdg/data" \
  "$runtime_dir/xdg/cache" \
  "$runtime_dir/xdg/state" \
  "$storage_root"
chmod 700 "$storage_root"
printf '%s\n' 'OPENCODE_ISOLATION_CANARY_91d83a' > "$protected_path"
chmod 600 "$protected_path"

policy_path="$runtime_dir/subject-broker.yaml"
if test -e "$policy_path"; then
  echo "Refusing to overwrite existing runtime policy: $policy_path" >&2
  echo "Remove the generated .runtime directory manually if a fresh fixture is intended." >&2
  exit 1
fi

{
  printf '%s\n' \
    'version: 1' \
    "storageRoot: $storage_root" \
    'subjects:' \
    '  - orchestrator' \
    '  - worker' \
    'resources:' \
    '  secret:' \
    "    path: $protected_path" \
    'rules:' \
    '  - subject: orchestrator' \
    '    resource: secret' \
    '    action: read' \
    '    decision: allow' \
    '  - subject: worker' \
    '    resource: secret' \
    '    action: read' \
    '    decision: deny'
} > "$policy_path"
chmod 600 "$policy_path"

printf '%s\n' \
  "Fixture prepared." \
  "OpenCode project: $project_dir" \
  "Authentication data is isolated below $runtime_dir/xdg/data."
