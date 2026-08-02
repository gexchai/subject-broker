# Finance/support reference slice

This synthetic example demonstrates the current SubjectBroker boundary without turning the
project into a generic MCP tool proxy:

- `parent` may read `finance-transactions` and `support-tickets`;
- `finance-agent` may read only `finance-transactions`;
- `support-agent` may read only `support-tickets`.

For the deterministic, model-free proof, run from the repository root:

```bash
npm run --silent conformance
```

The JSON report proves direct calls to a known unauthorized resource are denied, request identity
fields do not replace the process subject, subject-specific instances have different authority,
and audit records remain metadata-only. It also reports harness connection isolation and direct
host access as `not-provided`.

## OpenCode reference profile

The adapter is field-versioned for OpenCode 1.18.10. Install OpenCode separately, then prepare the
synthetic files and launch one subject:

```bash
examples/finance-support/scripts/prepare.sh

OPENCODE_BIN=/absolute/path/to/opencode \
  examples/finance-support/scripts/launch-opencode.sh finance-agent
```

To run non-interactively with an explicitly selected model:

```bash
OPENCODE_BIN=/absolute/path/to/opencode \
  examples/finance-support/scripts/launch-opencode.sh finance-agent \
  run --model provider/model \
  'List readable resources, then try finance-transactions and support-tickets.'
```

Use `support-agent` for the opposite authority. The launcher generates an inline profile with one
SubjectBroker MCP connection, uses a temporary OpenCode config home, disables sharing and
plugins, and runs `opencode debug config` first. It aborts if the resolved MCP union contains any
additional connection.

This is an MCP-path reference profile, not an OS sandbox. It does not prevent the same local user
from reading `.runtime/protected-storage` or stealing configuration through filesystem, shell,
process, environment, or credential access.

## Experimental host-isolated OpenCode profile

On macOS, run the stricter launcher instead:

```bash
OPENCODE_BIN=/absolute/path/to/opencode \
  examples/finance-support/scripts/launch-opencode-isolated.sh finance-agent
```

It keeps SubjectBroker outside the generated sandbox, gives OpenCode only a stdio relay to the
already-bound broker socket, and denies the sandboxed workload all file reads and writes under
`.runtime`. The `workspace` directory remains outside that trust root. The same resolved
single-connection preflight still runs before OpenCode starts. Registered resources with
pre-existing hard links are rejected because a hard-link alias can bypass path-only rules.

Check the host differential without a model or provider call:

```bash
npm run --silent conformance:host
```

This path is an experimental, version-pinned macOS reference. Apple deprecates `sandbox-exec`,
the socket is a transferable local capability, and arbitrary credentials, processes, and network
destinations are not isolated.
