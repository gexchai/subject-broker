# OpenCode integration

Status: `field-tested` for OpenCode 1.18.10 named subagents, including nesting through depth 2.

SubjectBroker cannot stop OpenCode from using direct filesystem, shell, network, browser,
credential, or process access. Use OS-level isolation when the protected storage path must be
unreachable outside MCP.

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
