# Hermes Agent integration

Status: `field-tested` for Hermes Agent v0.19.0 (commit `cef85482`).

## Security conclusion

Hermes native delegation does not provide a distinct SubjectBroker subject boundary between a
parent and its delegated child. A child inherits the parent's visible MCP connections in the
tested version. If the parent can use an orchestrator-bound connection, the child must be treated
as having that authority too.

This is an integration constraint, not a SubjectBroker policy-evaluation failure. The broker sees
the subject bound to the connection and cannot identify a delegated child behind it.

## Supported topology for different subjects

```text
top-level Hermes process              top-level Hermes process
HERMES_HOME: orchestrator profile     HERMES_HOME: worker profile
└── sb-orchestrator only              └── sb-worker only
    └── SubjectBroker subject:             └── SubjectBroker subject:
        orchestrator                          worker
```

Use a separate top-level Hermes process and separate `HERMES_HOME` profile for every distinct
SubjectBroker subject. Each profile must contain only that subject's connection.

The single-subject delegation mechanism behind this topology was field-tested on 2026-07-29
against the same pinned version. In a worker-only profile, a delegated child enumerated only the
four `mcp__cg_worker__*` tools, and a direct attempt to call
`mcp__cg_orchestrator__read_resource` was rejected by Hermes itself (`"...is not a deferrable
tool"`). The orchestrator audit log remained empty, confirming that no orchestrator
`read_resource` outcome reached its audit path. This establishes absence at the harness boundary
rather than inferring it from a model refusal. The protection in the tested path comes from the
profile holding exactly one connection: inheritance is total, so the child inherited only what
the parent held. Adding a second subject's connection to a profile removes that guarantee for
every child spawned in it.

The raw transcript and exact prompts for this verification were not retained in the repository;
the result is an operator field-test record rather than independently replayable evidence.

Native delegation is acceptable only when the parent and all delegated children are intended to
share the same effective SubjectBroker authority.

## Unsupported topology

Do not place `sb-orchestrator` and `sb-worker` in one Hermes profile and expect `delegate_task` to
hide the orchestrator connection from the child. Tool descriptions can warn the model, but they
do not remove or reject the privileged tool.

## Verification checklist

Before claiming subject isolation:

1. Confirm the parent can see the MCP tools required for the test.
2. Record the child tool catalog; absence must be established at the harness boundary, not
   inferred from a model refusal.
3. Attempt a direct privileged-first call from the lower-authority context.
4. Confirm the harness rejects the call before SubjectBroker receives it.
5. Retain normalized configuration, exact prompts, raw tool transcript, provider response
   identifier, and complete audit logs.

Do not use Hermes `-t delegation` or `-t hermes-cli,delegation` as proof of child isolation
without the parent control. In the field test, those settings removed MCP tools from the parent,
so the child inherited nothing and appeared isolated for the wrong reason.

ADR-019's audit checker remains useful for deny-then-allow retries, but a `clear` result does not
establish safe delegation. A privileged-first child call through the orchestrator connection
looks like a single legitimate orchestrator allow.

See [ADR-018 and ADR-020](../DECISIONS.md),
[field evidence FE-02](field-evidence-2026-07-28.md), and the
[agent tool-isolation protocol](field-test-agent-tool-isolation.md).
