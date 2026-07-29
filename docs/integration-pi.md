# Pi integration and enforcement boundary

Status: `field-tested in part` for `@earendil-works/pi-coding-agent` 0.82.1 through
`pi-mcp-adapter` 2.15.0.

## Short answer

Pi's lack of built-in subagent delegation removes the parent-to-child inheritance problem tested
in Hermes. It does not remove the need for SubjectBroker policy rules.

SubjectBroker can enforce subject-specific policy, deny or release registered resources, and
audit reads when Pi calls the broker through the MCP adapter. The current project cannot force
every Pi read to use SubjectBroker or prevent Pi from reading protected storage directly through
its built-in tools and operating-system permissions.

## What works today

Field testing established that Pi can reach SubjectBroker through the third-party
`pi-mcp-adapter`. The adapter exposes separately named tools for separately configured
SubjectBroker servers, and subject attribution is preserved through authorization and audit.

```text
Pi worker process
└── sb-worker connection
    └── SubjectBroker subject: pi-worker
        └── policy deny + worker audit event

Pi orchestrator process
└── sb-orchestrator connection
    └── SubjectBroker subject: pi-orchestrator
        └── policy allow + orchestrator audit event
```

For a request that reaches SubjectBroker:

- the subject is fixed when the SubjectBroker process starts;
- request fields cannot substitute another subject;
- explicit policy determines allow or deny;
- released reads and denied reads receive the required metadata-only audit event;
- audit failure blocks content release.

See [field evidence](field-evidence-2026-07-28.md) and ADR-002, ADR-006, ADR-008, and ADR-012
in [the decision record](../DECISIONS.md).

## Policy is still required

A deployment with two Pi roles still needs explicit subject-resource rules:

```yaml
version: 1
subjects:
  - pi-orchestrator
  - pi-worker
resources:
  secret:
    path: /absolute/protected/storage/secret.txt
rules:
  - subject: pi-orchestrator
    resource: secret
    action: read
    decision: allow
  - subject: pi-worker
    resource: secret
    action: read
    decision: deny
```

The absence of native subagents makes the process topology simpler; it does not provide
authorization by itself.

## Required multi-role topology

Use one top-level Pi process and one single-subject MCP configuration for each distinct
SubjectBroker subject:

```text
Pi process A                         Pi process B
Pi config A                          Pi config B
└── sb-orchestrator only             └── sb-worker only
    └── --subject pi-orchestrator        └── --subject pi-worker
```

Separate processes alone are not sufficient. If both processes load the same MCP configuration
containing both subject-bound connections, each process can receive the union of both subjects'
SubjectBroker authority. The safe shape requires both process separation and a configuration
containing only the assigned subject's connection.

Pi 0.82.1 has no built-in delegation primitive to test against the parent-child isolation
matrix. This makes the native delegation rows inapplicable, not automatically secure. A Pi
extension or third-party package that implements subagents becomes a new harness and must be
tested independently.

## What is not enforced

SubjectBroker does not currently make itself the mandatory route for Pi resource access. Pi runs
with the permissions of its operating-system process and may have other paths to the same bytes:

```text
Brokered path
Pi → pi-mcp-adapter → SubjectBroker → policy → audit → content or denial

Uncovered path
Pi → built-in read / shell / extension → protected storage
```

Consequently, a correct `ACCESS_DENIED` response from `sb-worker` does not prove that the Pi
process cannot obtain the file through another tool. This is the direct-read limitation already
recorded in [the threat model](../THREAT_MODEL.md).

The current project provides:

- a stdio SubjectBroker MCP server;
- policy and process-bound subject enforcement for brokered reads;
- audit guarantees for `read_resource`;
- field evidence that `pi-mcp-adapter` preserves the bound subject end to end.

It does not currently provide:

- a first-party Pi adapter;
- a Pi extension that restricts the active tool set;
- an operating-system sandbox that prevents direct access to protected storage;
- proof that all Pi resource access is forced through SubjectBroker.

## Extension-level hardening

Pi's extension API exposes `setActiveTools()` and permits extensions to override built-in tools.
A purpose-built integration could use those capabilities to:

- expose only the assigned subject's SubjectBroker tools;
- disable the built-in `read` tool where appropriate;
- disable or restrict `bash`;
- reject differently scoped SubjectBroker tools before invocation.

This would be useful defense-in-depth and would make accidental bypass harder. It must not be
presented as an operating-system security boundary: extension code runs inside the Pi process,
and the process retains whatever filesystem and process permissions the host gives it.

See Pi's official
[extension documentation](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)
and
[subagent extension example](https://github.com/earendil-works/pi/tree/main/packages/coding-agent/examples/extensions/subagent).

## Path to stronger enforcement

If the product goal is only governed access through a named MCP tool, the current broker plus a
single-subject Pi configuration provides that behavior.

If the product goal is that Pi cannot obtain protected bytes by any other path, additional work
is required:

1. Add and field-test a first-party Pi integration profile.
2. Add a Pi extension that exposes only the assigned SubjectBroker connection and limits direct
   file and shell tools.
3. Treat that extension as defense-in-depth and test its harness-level rejection behavior.
4. Design an OS sandbox, container, or equivalent privilege boundary that denies the Pi process
   direct access to protected storage while preserving a usable broker communication path.
5. Attack-test direct file reads, shell reads, alternate processes, extension tools, and attempts
   to start a more-privileged broker.

## Current conclusion

Pi does not need native subagent-isolation rules because it has no native subagent mechanism in
the pinned version. It still needs SubjectBroker policy and a single-subject deployment
configuration.

The current project can enforce reads that arrive through SubjectBroker with the same
subject-policy-audit behavior demonstrated in other harnesses. It cannot yet force Pi to use that
route exclusively.
