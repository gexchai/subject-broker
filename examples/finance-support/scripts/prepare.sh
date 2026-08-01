#!/bin/sh
set -eu

if test "$(uname -s)" != "Darwin"; then
  echo "The current hard-enforcement reference slice requires macOS." >&2
  exit 1
fi

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
example_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
repo_root=$(CDPATH= cd -- "$example_dir/../.." && pwd)
runtime_dir="$example_dir/.runtime"
storage_dir="$runtime_dir/protected-storage"
audit_dir="$runtime_dir/audit"
policy_path="$runtime_dir/subject-broker.yaml"

npm run build --prefix "$repo_root"
mkdir -p "$storage_dir" "$audit_dir"
chmod 700 "$storage_dir" "$audit_dir"
printf '%s\n' 'FINANCE_REFERENCE_CANARY_6e21b8' > "$storage_dir/finance-transactions.txt"
printf '%s\n' 'SUPPORT_REFERENCE_CANARY_83d4ac' > "$storage_dir/support-tickets.txt"
chmod 600 "$storage_dir/finance-transactions.txt" "$storage_dir/support-tickets.txt"

printf '%s\n' \
  'version: 1' \
  "storageRoot: $storage_dir" \
  'subjects:' \
  '  - parent' \
  '  - finance-agent' \
  '  - support-agent' \
  'resources:' \
  '  finance-transactions:' \
  "    path: $storage_dir/finance-transactions.txt" \
  '  support-tickets:' \
  "    path: $storage_dir/support-tickets.txt" \
  'rules:' \
  '  - subject: parent' \
  '    resource: finance-transactions' \
  '    action: read' \
  '    decision: allow' \
  '  - subject: parent' \
  '    resource: support-tickets' \
  '    action: read' \
  '    decision: allow' \
  '  - subject: finance-agent' \
  '    resource: finance-transactions' \
  '    action: read' \
  '    decision: allow' \
  '  - subject: finance-agent' \
  '    resource: support-tickets' \
  '    action: read' \
  '    decision: deny' \
  '  - subject: support-agent' \
  '    resource: finance-transactions' \
  '    action: read' \
  '    decision: deny' \
  '  - subject: support-agent' \
  '    resource: support-tickets' \
  '    action: read' \
  '    decision: allow' \
  > "$policy_path"
chmod 600 "$policy_path"

printf '%s\n' "Prepared synthetic finance/support runtime at $runtime_dir"
