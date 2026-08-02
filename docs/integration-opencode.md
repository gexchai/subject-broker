# OpenCode integration

Status: `field-tested` for OpenCode 1.18.10 named subagents, including nesting through depth 2.

The ordinary SubjectBroker adapter cannot stop OpenCode from using direct filesystem, shell,
network, browser, credential, or process access. ADR-027 adds an experimental macOS launcher for
one dedicated trust root; it is not a general or production-supported sandbox.

## Security conclusion

OpenCode can enforce a narrower SubjectBroker MCP tool set for a named child inside one project,
but it is not safe by default. The field test proved that the built-in `general` child could use
the parent's orchestrator-bound connection and receive protected content.

For every distinct-subject child:

- define a named `mode: "subagent"` agent;
- start its permissions with `"*": "deny"`;
- allow only the exact MCP tools for its assigned SubjectBroker connection;
- on the parent, allow `task` only for that exact named agent;
- repeat the restriction at every nested delegation edge; and
- do not fall back to `general` if the named agent is unavailable.

## Verified configuration shape

OpenCode names MCP tools as `<server>_<tool>`. With servers `sbOrchestrator` and `sbWorker`, the
read tools are `sbOrchestrator_read_resource` and `sbWorker_read_resource`.

```json
{
  "agent": {
    "orchestrator-parent": {
      "mode": "primary",
      "permission": {
        "*": "deny",
        "task": {
          "*": "deny",
          "restricted-worker": "allow"
        },
        "sbOrchestrator_read_resource": "allow",
        "sbWorker_read_resource": "allow"
      }
    },
    "restricted-worker": {
      "mode": "subagent",
      "permission": {
        "*": "deny",
        "sbWorker_read_resource": "allow"
      }
    }
  }
}
```

The parent may hold both connections, but only the parent and explicitly permitted agent types
should be able to use them. Do not give a worker a server-wide wildcard unless every tool on that
server is intended for that worker.

If nested delegation is required, give the intermediate worker only a narrow `task` allowlist
for a separately defined restricted grandchild. OpenCode 1.18.10 defaults to a subagent depth of
1. The field test raised `subagent_depth` to 2 for one isolated case and re-established the
worker positive control and privileged-tool rejection at the grandchild.

## Verification checklist

1. Run a parent control that successfully calls the privileged connection and confirm its allow
   audit.
2. Run an unfiltered-child control so unsafe inheritance is observable rather than assumed.
3. Export the named child session and confirm its agent type and parent linkage.
4. Exercise an allowed worker tool; an empty audit alone is not a positive control.
5. Attempt the exact privileged tool name and require an OpenCode-level unavailable/permission
   rejection before SubjectBroker receives it.
6. Keep the orchestrator audit empty for the restricted case.
7. Repeat the checks at every delegation depth used in production.

See ADR-018, ADR-024,
[the field-test protocol](field-test-opencode-subagent-isolation.md), and
[the retained results](../results/opencode-confirmation/README.md).

## Single-subject reference launcher

The finance/support example includes a conservative launcher for one top-level OpenCode process:

```bash
examples/finance-support/scripts/prepare.sh

OPENCODE_BIN=/absolute/path/to/opencode \
  examples/finance-support/scripts/launch-opencode.sh finance-agent
```

The launcher uses a temporary OpenCode config home and inline configuration, then inspects the
fully resolved config before starting the session. It fails with
`OPENCODE_PROFILE_NOT_ISOLATED` if the MCP union contains anything other than the one generated
subject-bound connection. Sharing and external plugins are disabled, and the generated default
agent begins with wildcard deny plus exact allows for that connection's four SubjectBroker tools.

OpenCode merges remote, global, project, inline, and managed configuration sources, as described
in its [official configuration precedence](https://opencode.ai/docs/config/). Supplying an inline
MCP entry without checking the resolved union is therefore not an isolation control. The launcher
preflight addresses that configuration failure mode for the tested profile; it is not an OS
sandbox and does not protect same-user files, processes, environments, or credentials.

## Experimental macOS host-isolated launcher

The finance/support example also provides a stricter path:

```bash
examples/finance-support/scripts/prepare.sh

OPENCODE_BIN=/absolute/path/to/opencode \
  examples/finance-support/scripts/launch-opencode-isolated.sh finance-agent
```

This launcher performs the same resolved-config preflight, but it starts SubjectBroker outside
the workload sandbox and replaces OpenCode's local MCP command with a content-agnostic
stdio-to-Unix-socket relay. The relay sees the assigned owner-only socket path, not the policy,
storage, audit, or subject startup arguments.

The policy file, registered storage, and audit destination must share a dedicated trust root
outside the OpenCode workspace. The generated macOS profile denies the sandboxed process every
file read and write under that root. Invalid path topology, missing `sandbox-exec`, broker startup
failure, a registered resource with link count other than one, a changed resolved MCP union, or
an OpenCode failure aborts the launch.

Verify the model-free differential independently:

```bash
npm run --silent conformance:host
```

The report proves that direct and workspace-symlink reads fail while the external authorized
broker remains usable and continues to deny a known unauthorized resource. It deliberately
reports the harness as `not-exercised` and non-transferable identity as `not-provided`.

Apple marks `sandbox-exec` deprecated. The result is version-pinned research evidence, not a
portable production guarantee. The socket remains a local bearer capability; arbitrary network,
credential, and same-user process isolation remain outside scope.

See [the finance/support reference slice](../examples/finance-support/README.md), ADR-025, and
ADR-026–027.
