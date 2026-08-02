# Decisions

Status: `decided`

This is an append-only architecture decision record for the spike. Existing entries are not rewritten; superseding decisions must add a new entry that cites the old one. The sole project owner is the approver for this spike.

## Supersession index

Earlier entries remain as historical records. Read these replacements as the current decision:

| Earlier text | Status | Current decision |
| --- | --- | --- |
| ADR-004 uses leaf-only `O_NOFOLLOW` for registered resource opens | Superseded in part | ADR-016 uses macOS whole-path `O_NOFOLLOW_ANY` |
| ADR-006 says "every allow, deny, or error" without naming the operation | Superseded in part | ADR-012 scopes the audit contract to `read_resource` outcomes |
| ADR-015 rejects audit symlinks but does not cover ancestor symlinks or runtime diagnostics | Superseded in part | ADR-017 applies whole-path rejection and distinguishes internal audit diagnostics |
| ADR-019 detects deny-then-allow cross-subject retries | Scope clarified | ADR-020 records that privileged-first Hermes delegation produces no detectable cross-subject sequence |
| ADR-002 names the `CONTEXTGUARD_SUBJECT` environment variable | Superseded in naming only | ADR-023 renames the project and environment prefix; process-level subject binding is unchanged |

## ADR-001 — Evidence before broader design

**Decision:** Build and attack-test the smallest broker path before designing additional adapters or governance machinery.

**Rationale:** Traversal, identity, file-race, leakage, and audit-failure behavior need executable evidence.

**Evidence:** `tests/security/` and `tests/integration/mcp-transport.test.ts`.

## ADR-002 — Process-level subject binding

**Decision:** Supply the subject once at startup using `--subject` or `CONTEXTGUARD_SUBJECT`. Keep it immutable. Ignore every identity-like field in tool arguments.

**Rationale:** Authorization must not trust identity selected by the request being authorized.

**Evidence:** `tests/security/identity-substitution.test.ts`.

## ADR-003 — Stable registered resource identifiers

**Decision:** Tool requests accept only registered identifiers. The registry maps each identifier to an absolute path; request values are never joined to or resolved as paths.

**Rationale:** Separating identifiers from paths removes traversal and absolute-path resolution from the request surface.

**Evidence:** `tests/security/path-identifiers.test.ts` and `tests/unit/resource-registry.test.ts`.

## ADR-004 — macOS protected storage and descriptor identity

**Decision:** For this macOS slice, require the configured storage directory to be outside the working tree with mode `0700`. Reject symlinks in registered paths. Record device and inode at registration. For a read, open with `O_NOFOLLOW`, verify the descriptor with `fstat`, and read from that same descriptor.

**Rationale:** This blocks tested path, symlink-swap, and file-replacement attacks on the broker path without claiming same-user isolation.

**Evidence:** `tests/security/symlink-swap.test.ts`, `tests/security/toctou.test.ts`, and `tests/unit/resource-registry.test.ts`.

## ADR-005 — Strict explicit policy

**Decision:** Use one YAML document with schema version `1`, subjects, resources, and explicit subject-resource-action rules. Default deny. Missing files, parse errors, duplicate keys, unknown fields, unknown references, and unknown versions are hard failures.

**Rationale:** Ambiguous or partially understood policy must not become an implicit allow.

**Evidence:** `tests/unit/policy.test.ts` and `tests/security/policy-failure.test.ts`.

## ADR-006 — Audit failure blocks reads

**Decision:** Append one metadata-only JSONL event for every allow, deny, or error. A read is released only after its allow event is durably appended. Audit failure blocks the read.

**Rationale:** This deliberately trades availability for the spike's claim that every released read has an audit event.

**Evidence:** `tests/security/audit-failure.test.ts` and `tests/integration/mcp-transport.test.ts`.

## ADR-007 — Closed, non-sensitive reason codes

**Decision:** Expose only a closed reason-code enum. Unknown and forbidden resources use the same external `ACCESS_DENIED` code. Responses, explanations, errors, and audit events omit bytes and paths on denial.

**Rationale:** Denials must not disclose resource existence or protected content.

**Evidence:** `tests/unit/policy.test.ts` and `tests/security/leakage.test.ts`.

## ADR-008 — Per-process server, no daemon

**Decision:** Run one stdio MCP server process for one configured subject. Policy and registry are loaded at startup; configuration changes require restart. Resource identity is rechecked on every read.

**Rationale:** A short-lived process gives the spike a small identity and lifecycle boundary.

**Evidence:** `tests/integration/mcp-transport.test.ts` and `tests/security/toctou.test.ts`.

## ADR-009 — TypeScript stack and dependencies

**Decision:** Use TypeScript in strict ESM mode on Node.js 20+, the official `@modelcontextprotocol/sdk`, `yaml` for strict YAML parsing, `zod` for closed runtime schemas used by the SDK and policy loader, and Vitest for tests. TypeScript and Node type declarations are development-only dependencies. Override the SDK's compatible `@hono/node-server` transitive range to `2.0.12` to avoid older static-file path-traversal and WebSocket-handshake advisories, even though this spike uses only stdio.

**Rationale:** The MCP SDK is required by the task. YAML avoids maintaining an unsafe ad hoc parser. Zod is the SDK's schema peer and lets the policy and tool inputs reject unknown fields. Vitest provides isolated unit and attack tests.

**Evidence:** `package.json`, `tsconfig.json`, and `npm test`.

## ADR-010 — Claude Code is the first integration

**Decision:** Integrate the stdio MCP server with Claude Code rather than treating “Secure MCP” as a platform.

**Rationale:** Claude Code is an actual target the project owner uses and can test; MCP is the transport, not an adapter identity.

**Evidence:** `docs/integration-claude-code.md` and `tests/integration/mcp-transport.test.ts`.

## ADR-011 — Spike capability scope

**Decision:** Report `hard-enforcement` only for the broker's registered-resource read operation on macOS. Report direct filesystem and other context paths as uncovered.

**Rationale:** A precise capability claim preserves the distinction between broker correctness and whole-agent isolation.

**Evidence:** `tests/unit/capability-report.test.ts` and the generated fixture capability report.

## ADR-012 — Audit contract is scoped to brokered reads

**Decision:** Supersede the ambiguous first sentence of ADR-006: append exactly one metadata-only
JSONL event for every `read_resource` allow, deny, or error. `list_resources`,
`explain_decision`, and `capability_report` are not audited by this spike.

**Rationale:** The implemented security claim is that every released read is durably recorded.
Auditing non-content tool invocations is a separate operational requirement with undefined
failure semantics.

**Evidence:** `tests/unit/broker-audit.test.ts`, `tests/security/audit-failure.test.ts`, and
`tests/integration/mcp-transport.test.ts`.

## ADR-013 — Strict server startup with non-sensitive diagnostic categories

**Decision:** The MCP server exits non-zero when policy or registry initialization fails and
reports only a stable diagnostic category. The programmatic broker API retains explicit
fail-closed construction for attack tests and embedding use cases.

**Rationale:** A server that silently starts with no usable policy is difficult to operate.
Stable categories make failures actionable without returning paths, policy content, or protected
bytes to MCP callers.

**Evidence:** `tests/unit/startup-diagnostics.test.ts` and
`tests/security/policy-failure.test.ts`.

## ADR-014 — Session-pinned text resources

**Decision:** Keep device and inode pinned for the server lifetime. Authorized atomic
rename-replacement updates require restart; replacements are not trusted automatically.
Resources are valid UTF-8 text and default to a maximum size of 1 MiB, configurable at startup.

**Rationale:** Automatically accepting a new inode would remove the replacement-attack guarantee
from ADR-004. Bounding reads avoids unbounded allocation, and strict decoding prevents silent
binary corruption.

**Evidence:** `tests/security/toctou.test.ts` and `tests/security/resource-content.test.ts`.

## ADR-015 — Strict startup arguments and audit destinations

**Decision:** Parse startup flags as a closed set of flag-value pairs and reject missing values,
duplicates, unknown flags, and invalid size limits with stable non-sensitive categories. At
strict server startup and before every append, require the audit destination to be a regular
non-symlink file with mode exactly `0600`.

**Rationale:** A neighboring flag must never be consumed as a value, and operator mistakes should
be distinguishable without exposing paths or protected content. Creation mode alone does not
restrict a pre-existing audit file.

**Evidence:** `tests/unit/startup-diagnostics.test.ts`,
`tests/unit/audit-destination.test.ts`, and `tests/integration/startup-failure.test.ts`.

## ADR-016 — Whole-path symlink rejection on macOS

**Decision:** Open registered resources with macOS `O_NOFOLLOW_ANY` instead of the leaf-only
`O_NOFOLLOW`, then retain the existing regular-file and device/inode checks on the returned
descriptor. Use the raw SDK flag value because Node.js does not expose the constant.

**Rationale:** `O_NOFOLLOW` protects only the leaf component. Rejecting symlinks in the entire
path preserves the registration invariant if an ancestor is replaced after startup, while
descriptor identity verification continues to prevent replacement content from being released.

**Evidence:** `tests/security/symlink-swap.test.ts` and the macOS SDK definition in
`sys/fcntl.h`.

## ADR-017 — Whole-path audit validation and internal failure diagnostics

**Decision:** On macOS, open audit destinations with `O_NOFOLLOW_ANY`. Create a missing audit
file exclusively and explicitly set mode `0600`, so a restrictive process umask cannot leave an
unusable file behind. Continue exposing only `AUDIT_FAILED` to MCP callers, while emitting
`AUDIT_DESTINATION_INVALID` or `AUDIT_WRITE_FAILED` through the server's non-sensitive stderr
diagnostic channel and the broker's optional diagnostic callback.

**Rationale:** Audit writes should not follow an ancestor symlink when resource reads do not.
Creation must produce the documented mode independent of umask. Separating internal operational
causes improves diagnosis without expanding the caller-visible reason-code surface.

**Evidence:** `tests/unit/audit-destination.test.ts` and
`tests/security/audit-failure.test.ts`.

## ADR-018 — Agent contexts must not receive more-privileged connections

**Decision:** Treat the union of all subject-bound ContextGuard connections visible to one agent
context as that context's effective ContextGuard authority. The supported multi-agent deployment
exposes each context only to the connection for its assigned subject and never exposes a worker
to a more privileged subject's connection. Report this as a capability assumption and name the
co-location path as uncovered. Include the bound subject and a cross-connection retry warning in
tool descriptions as defense-in-depth, not as enforcement.

**Rationale:** A broker can bind and evaluate its own subject correctly but cannot control which
other MCP tools a third-party harness gives the same model. Field testing showed a model retrying
a denied worker read through a visible orchestrator connection and receiving the content; both
individual broker decisions and audit events remained correct.

**Evidence:** `docs/field-evidence-2026-07-28.md`, finding FE-01;
`tests/integration/mcp-transport.test.ts`; and
`tests/unit/capability-report.test.ts`.

## ADR-019 — Cross-subject audit checking is an offline heuristic

**Decision:** Provide an offline command that combines one or more audit JSONL files and flags a
deny followed within a configurable window by an allow for a different subject on the same
resource. Return structured output and a distinct exit status for suspicious matches. Do not
present the checker as prevention, proof of compromise, or a daemon.

**Rationale:** FE-01 produced a clear sequence in existing audit metadata, so automatically
surfacing that sequence reduces review cost without changing broker authorization or ADR-008's
process model. The pattern may be legitimate under concurrency and cannot detect an agent that
uses the privileged connection first.

**Evidence:** `src/audit-check.ts`, `tests/unit/audit-check.test.ts`, and
`tests/integration/audit-check-cli.test.ts`.

## ADR-020 — Hermes native delegation is same-authority only

**Decision:** Do not use Hermes Agent v0.19.0 native parent/child delegation to assign different
ContextGuard subjects. Treat a delegated child as having the parent's effective ContextGuard
authority. Native delegation is supported only when parent and child are intended to have the
same authority. When subjects must differ, run separate top-level Hermes processes with separate
`HERMES_HOME` profiles, each containing only its assigned subject-bound connection.

Do not treat tool-description warnings or ADR-019's audit checker as enforcement. A
privileged-first child call produces only a valid allow event, so the checker cannot distinguish
it from legitimate parent activity. Isolation claims must also establish the parent's visible
tool set: Hermes `-t` filtering can remove MCP tools from the parent and create a false pass.

**Rationale:** Version-pinned field testing found that a native delegated child inherited both
subject-bound connections visible to its parent and could invoke the orchestrator-bound read.
Hermes exposed no per-child MCP-connection filter in the tested path. ContextGuard cannot recover
the child's identity from a request arriving through the parent's connection.

**Evidence:** `docs/field-evidence-2026-07-28.md`, finding FE-02, including its
evidence-retention limitation; `docs/field-test-agent-tool-isolation.md`; and
`docs/integration-hermes.md`.

## ADR-021 — Claude Code distinct subjects require named custom-subagent allowlists

**Decision:** Support distinct ContextGuard subjects inside one Claude Code 2.1.220 parent
session only through persistent named custom subagents whose `tools` field explicitly allowlists
the assigned subject's MCP tools. Treat ordinary unfiltered subagents as having the parent's
effective ContextGuard authority. Exclude forks, agent teams, nested delegation, and direct
filesystem or shell access from this guarantee unless separately tested.

The verified worker definition contains only the four `mcp__cg-worker__*` tools. A missing,
misspelled, or broader allowlist is a deployment failure and must not fall back to an ordinary
subagent.

**Rationale:** A retained confirmation run established the necessary controls. The parent could
exercise the orchestrator connection. An unfiltered default child inherited and exercised it. A
persistent `restricted-worker` child exercised its allowed worker connection, while the
privileged-first restricted case produced no tool call, canary, or orchestrator `read_resource`
audit outcome. The restricted result is accepted through a controlled differential with
harness-authored metadata and privately captured transcripts rather than a per-child catalog
artifact. The public repository retains minimized relevant events and source hashes.

**Evidence:** `docs/field-evidence-2026-07-28.md`, finding FE-03;
`docs/field-test-claude-code-subagent-isolation.md`;
`results/claude-code-confirmation/`; and `docs/integration-claude-code.md`.

## ADR-022 — Codex 0.144.4 native delegation is same-authority only

**Decision:** Do not use Codex CLI 0.144.4 native delegation to assign a child a different
ContextGuard subject from its parent. Treat a native child as having the parent's effective
ContextGuard authority. For distinct subjects, run separate top-level Codex processes with
separate `CODEX_HOME` profiles, each containing only its assigned subject-bound connection.
Native delegation is supported within those profiles only when parent and child are intended to
have the same authority.

Do not treat a custom-agent configuration file as enforcement unless the installed spawn surface
provides and exercises a selector that loads it for the child. The tested `spawn_agent` surface
had no custom-agent type or per-child MCP filter.

**Rationale:** A retained field test showed a default child inheriting and exercising the
two-connection parent's orchestrator-bound read. In the control topology, a child of a
worker-only Codex process could exercise only the worker connection and received the expected
broker denial; a privileged-first orchestrator attempt emitted no call and no orchestrator audit
event. The worker-only result was repeated through a grandchild at delegation depth 2.

**Evidence:** `docs/field-evidence-2026-07-28.md`, finding FE-04;
`docs/field-test-codex-subagent-isolation.md`;
`results/codex-confirmation/`; and `docs/integration-codex.md`.

## ADR-023 — Rename the project to SubjectBroker

**Decision:** Rename the current project and implementation from the working name
**ContextGuard** to **SubjectBroker**. Use `subject-broker` for the package and MCP server name,
`SUBJECT_BROKER_*` for environment variables, and `sb-*` for new connection examples. Preserve
the former name and `cg-*` labels in ADR-001–022, dated field-test documents, and retained
evidence where changing them would rewrite the historical record.

MCP remains the first implemented transport, not part of the durable project identity. Keep the
version 1 policy schema fields `subjects`, `resources`, and `rules` unchanged.

**Rationale:** The ContextGuard name collides with existing AI-security software and an npm
package, while “guard” implies broader enforcement than this brokered path provides.
SubjectBroker describes the stable mechanism: a process-bound subject mediates registered
resource reads through explicit policy and metadata-only auditing. A protocol-independent name
also allows later transports without renaming the authority model.

**Evidence:** `package.json`, `README.md`, `src/server.ts`, `src/mcp-server.ts`,
`docs/integration-claude-code.md`, and `results/README.md`.

## ADR-024 — OpenCode distinct subjects require named exact tool allowlists

**Decision:** Support distinct SubjectBroker subjects inside one OpenCode 1.18.10 project only
through specifically named subagents whose permissions start with wildcard deny and then allow
only the assigned subject's exact MCP tools. Every parent or intermediate child must also limit
its `task` permission to the exact intended named child. Treat the built-in `general` subagent as
having the parent's effective SubjectBroker authority.

Apply the restriction at every delegation level. The tested result covers depths 1 and 2 only.
Do not infer the same result for arbitrary depth, plugins, remote server mode, OpenCode 2.0 beta,
future versions, or direct filesystem and shell paths.

**Rationale:** The retained parent control proved the orchestrator connection was active. An
unfiltered `general` child inherited and exercised it, returning the canary. Named restricted
children exercised the worker connection and received the expected deny. At depth 2, a named
grandchild attempted the exact excluded orchestrator tool; OpenCode rejected the call as
unavailable and reported only the worker tool as available, while the orchestrator audit stayed
empty. Version-pinned source review found denied-tool filtering before the model request and a
second permission check at MCP execution.

**Evidence:** `docs/field-test-opencode-subagent-isolation.md`,
`docs/integration-opencode.md`, and `results/opencode-confirmation/`.

## ADR-025 — Separate broker, harness, and host enforcement claims

**Decision:** Describe SubjectBroker authorization, agent-harness connection visibility, and
host/workload isolation as three independent enforcement layers. A passing broker read test must
not be presented as proof that a harness withheld another subject's connection or that the host
blocked direct access. Machine-readable reports must identify the layer for every check and may
report uncovered layers as `not-provided` without converting them into a false failure or pass.

Do not claim that a server can distinguish parent and child after both receive the same valid
bearer credential unless a trusted non-transferable subject signal also exists. Credential or
connection identifiers are audit metadata, not identity proof.

**Rationale:** Field evidence established that correct per-process broker decisions can coexist
with unsafe connection inheritance. Conversely, a tool-visibility pass does not close direct
same-user access. Keeping these claims separate prevents a future credential or adapter feature
from overstating the boundary.

**Evidence:** `docs/security-boundary.md`, `THREAT_MODEL.md`, and
`src/conformance.ts`.

## ADR-026 — Deterministic conformance before broader protocol scope

**Decision:** Keep the next vertical slice inside the registered-resource model. Provide a
model-free finance/support conformance command that exercises MCP calls directly and emits a
schema-versioned JSON report. Include parent authority, per-subject listings, direct calls to
known unauthorized identifiers, request identity spoofing, subject-specific authority, and
metadata-only audit evidence.

Provide OpenCode 1.18.10 as the first reference launcher. Generate a temporary single-subject
profile, resolve it through OpenCode before launch, and abort if any additional MCP connection is
present. Treat this as an adapter control, not a broker or OS guarantee. Do not add generic
upstream MCP tool proxying, OAuth, credential IDs, or IAM policy features in this milestone.

**Rationale:** Most server-side properties already exist as separate tests. Packaging them into
one adversarial report proves the current technical claim and exposes uncovered layers without
prematurely pivoting SubjectBroker into a general authorization gateway.

**Evidence:** `src/conformance.ts`, `tests/integration/conformance-cli.test.ts`,
`src/opencode-adapter.ts`, `tests/unit/opencode-adapter.test.ts`, and
`examples/finance-support/`.

## ADR-027 — Experimental macOS host-isolated reference topology

**Decision:** Add a version-pinned macOS reference launcher that starts the subject-bound broker
outside the agent sandbox, exposes that already-bound authority through an owner-only Unix
socket, and runs OpenCode inside a generated `sandbox-exec` profile. The sandboxed OpenCode MCP
command is a content-agnostic stdio-to-socket relay; it receives the assigned socket path but not
the policy, audit, storage, or subject startup arguments.

Require policy, registered storage, and audit destination to share one dedicated trust root that
does not contain the agent workspace. Deny the sandboxed workload all file reads and writes under
that trust root. Require every registered resource to be a regular file with link count exactly
one so a pre-existing hard-link alias cannot bypass path-based sandbox rules. Fail closed if the
topology, file identity, macOS host mechanism, or fully resolved single-connection OpenCode
profile is unavailable. Keep the existing unsandboxed adapter as an explicit broker-path-only
option.

Report enforcement by layer. The deterministic host report may mark the tested broker and direct
host-resource paths as `enforced`, while marking the agent harness as `not-exercised` and
non-transferable subject identity as `not-provided`. Do not upgrade the broker's own capability
report based on an external launcher it cannot attest.

**Rationale:** Applying one sandbox to both OpenCode and its stdio broker would deny the broker's
legitimate storage access. Moving only the broker outside the sandbox creates a testable
differential: the workload cannot open the file, including through a workspace symlink, while
the process-bound broker can still release an authorized resource and deny an unauthorized one.
Protecting the entire trust root also prevents ancestor-directory mutation from bypassing
individual file rules.

`sandbox-exec` is deprecated by Apple, is not a stable portable production interface, and does
not create non-transferable identity. The Unix socket remains a local bearer capability. This
reference excludes compromised same-user processes, inherited pre-opened descriptors, arbitrary
other sensitive paths, credential isolation, network isolation, and future macOS behavior unless
retested.

**Evidence:** `src/isolated-opencode.ts`, `src/socket-broker.ts`,
`src/unix-socket-transport.ts`, `src/host-conformance.ts`,
`tests/security/isolated-opencode.test.ts`, `tests/integration/host-isolation.test.ts`,
`tests/integration/socket-transport.test.ts`, and
`tests/integration/host-conformance-cli.test.ts`.
