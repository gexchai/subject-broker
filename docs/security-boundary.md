# SubjectBroker security boundary

Status: `implemented` for the v0.1 registered-resource MCP path; this document defines the
boundary carried into the v0.2 conformance work.

SubjectBroker has one hard-enforcement claim: on the tested macOS path, a subject-bound broker
process releases a registered UTF-8 resource only when its policy, file-identity, bounded-read,
and fail-closed audit checks all succeed.

That claim must not be confused with agent-harness or host isolation.

## Three enforcement layers

| Layer | Trusted decision | Current project result |
| --- | --- | --- |
| SubjectBroker | Whether the process-bound subject may read one registered resource | Enforced and covered by deterministic tests |
| Agent harness | Which subject-bound MCP connections and tools an agent context can discover or invoke | Harness-dependent; version-pinned field results only |
| Host / workload | Whether an agent can read storage or obtain another subject's configuration outside MCP | Not provided |

```text
agent context
    │  harness decides which connection is visible
    ▼
subject-bound SubjectBroker process
    │  broker decides whether this subject may read this resource
    ▼
registered storage
       host isolation decides whether another path can bypass the broker
```

Passing one layer does not imply that another layer passed. An empty orchestrator audit can mean
the harness excluded a tool, the model declined to call it, or the test never activated the
connection. A broker deny does not prevent a child from using a second, more-privileged
connection supplied by its harness. A correct MCP result does not prevent a same-user direct file
read.

## Identity and credential rule

The current stdio prototype binds identity through trusted startup configuration. It does not
issue cryptographic credentials and does not claim non-transferable workload identity.

A future credential mode must obey this rule:

> If a child receives the same valid bearer credential as its parent, the server must treat that
> credential as the same authority unless it also receives a trusted, non-copyable subject signal.

Credential IDs, connection IDs, tool descriptions, prompts, and caller-supplied subject fields do
not create that signal. A narrower server-side authority requires the privileged credential never
to reach the child, or requires a separate authenticated process/OS identity, trusted delegation
service, workload attestation, or equivalent non-transferable mechanism.

## Current conformance claim

`npm run --silent conformance` exercises a synthetic finance/support fixture without a model and
keeps stdout as machine-readable JSON:

- a parent may read both registered resources;
- each child subject lists and reads only its allowed resource;
- direct calls to the exact hidden resource ID are denied;
- identity-like request fields cannot replace the process subject;
- starting the same policy under a different subject changes authority; and
- every tested read has a subject-aware metadata-only audit event.

The report deliberately returns `not-provided` for harness connection isolation, direct host
access, and non-transferable subject credentials. Overall `pass` means every tested
SubjectBroker-layer check passed; it is not a whole-agent security certification.

## OpenCode reference profile

The OpenCode adapter creates a temporary config home, injects exactly one subject-bound MCP
connection, disables sharing and external plugins, and checks the fully resolved configuration
with `opencode debug config` before launch. It fails closed if another MCP connection remains in
the resolved union.

This reduces configuration accidents for the tested OpenCode path. It remains an adapter-level
control and does not provide OS sandboxing, protect same-user credentials, or convert an arbitrary
existing OpenCode project into a trusted workload identity.

See ADR-018, ADR-025, ADR-026, [`THREAT_MODEL.md`](../THREAT_MODEL.md), and the
[finance/support reference slice](../examples/finance-support/README.md).
