# Threat Model

Status: `decided` for the spike

## Protected assets

- Bytes of registered protected resources.
- The process-bound subject identity.
- Policy rules and registry metadata.
- Audit events and denial explanations.

## In-scope actors

### Cooperative agent

An agent that requests protected resources through the four MCP tools and accepts broker decisions.

### Confused or injected agent

An agent influenced by malicious project content or malformed instructions that attempts to obtain protected bytes through the broker using:

- traversal, absolute, or encoded path-like identifiers;
- identity fields intended to substitute a more privileged subject;
- symlink swaps or file replacement;
- malformed, missing, or incompatible policy;
- error, explanation, stack-trace, or audit channels.

## In-scope guarantees

For the tested macOS MCP broker path:

- caller-supplied paths are not accepted;
- request identity fields do not change the process subject;
- policy defaults and hard failures deny;
- audit failure blocks a read;
- audit opens follow no symlink in the configured path on macOS, validate mode `0600`, and expose
  only a non-sensitive failure code to the caller;
- deny and tested error channels do not contain the protected canary;
- a read follows no symlink in the registered path on macOS and uses an already-open file
  descriptor whose device and inode match registration;
- a resource read is bounded and accepts only valid UTF-8.

Each guarantee is limited to behavior exercised by a named test in `DECISIONS.md`.

## Explicitly out of scope

- An agent with unrestricted shell or filesystem access reading the protected file directly.
- A same-user process launching another broker with a different subject, policy, or audit
  destination.
- A compromised host, kernel, administrator account, Node.js runtime, or SubjectBroker process.
- A malicious project owner who controls policy, registration, startup flags, or storage.
- Exfiltration, retention, or model-provider behavior after an allowed release.
- Side channels not exercised by the spike, including timing analysis.
- Cross-platform behavior outside macOS.

## Direct-read path

SubjectBroker does not close the direct-read path. A directory mode of `0700` excludes other operating-system users, but it does not isolate an agent running as the same user.

OS-level sandboxing or an equivalent privilege boundary is the only control that can close that path. SubjectBroker is complementary to such isolation and must not be presented as its replacement.

## Deployment invariant

An agent context's effective SubjectBroker authority is the union of every subject-bound
SubjectBroker connection visible to that context. The supported multi-agent deployment therefore
exposes each agent context only to the connection for its assigned subject; it must never expose
a worker to a more privileged subject's connection.

SubjectBroker cannot inspect or enforce tool visibility in the calling harness. Tool descriptions
and audit anomaly detection are defense-in-depth and detective controls, not substitutes for
harness-level isolation. This invariant is supported by field evidence in
[docs/field-evidence-2026-07-28.md](docs/field-evidence-2026-07-28.md), finding FE-01, and
recorded in ADR-018.

Hermes Agent v0.19.0 native delegation cannot satisfy this invariant when parent and child need
different subjects: a delegated child inherits the parent's visible MCP connections in the
tested topology. Use separate top-level Hermes processes and profiles for distinct subjects.
See ADR-020, [the Hermes integration guide](docs/integration-hermes.md), and field evidence
FE-02.

Claude Code 2.1.220 can satisfy the invariant inside one parent session for a persistent named
custom subagent with an explicit MCP `tools` allowlist. An unfiltered default subagent was
observed inheriting and exercising the orchestrator connection. Forks, agent teams, nested
delegation, and direct filesystem or shell access are outside this accepted topology. See
ADR-021, [the Claude Code integration guide](docs/integration-claude-code.md), and FE-03.

Codex CLI 0.144.4 native delegation cannot assign a narrower SubjectBroker subject to a child in
the tested path. A default child inherited and exercised the parent's orchestrator connection.
Use separate top-level Codex processes and `CODEX_HOME` profiles for distinct subjects. The
worker-only profile was verified through delegation depths 1 and 2. See ADR-022,
[the Codex integration guide](docs/integration-codex.md), and FE-04.

## Residual risks

- Same-user agents may bypass the broker through direct filesystem access.
- Resource metadata may reveal identifiers even when content is denied.
- Audit JSONL is append-only by application behavior, not tamper-evident against the project owner.
- Audit destinations are required to be regular `0600` files. Whole-path symlink rejection does
  not prevent the trusted same-user owner from replacing real directories or rewriting logs.
- A single agent context holding tool access to more than one subject-bound SubjectBroker
  connection can, in practice, exercise the union of those subjects' permissions if the model in
  the loop retries a denied read through a more permissive connection. Every individual decision
  and audit event remains correct; the risk is deployment shape, not policy evaluation. Observed
  against a real model in a controlled field test — see
  [docs/field-evidence-2026-07-28.md](docs/field-evidence-2026-07-28.md), finding FE-01.
- Hermes v0.19.0 native delegation can produce a privileged-first call with only an
  orchestrator/allow audit event. The ADR-019 checker correctly reports no deny-then-allow
  pattern, so a `clear` result is not evidence of delegated-agent isolation. See FE-02.
- Claude Code custom-subagent isolation depends on an exact allowlist. A missing, misspelled, or
  broader configuration can expose the parent's full SubjectBroker authority. The retained
  confirmation used controlled differential evidence rather than a per-child catalog artifact.
- Codex 0.144.4 native children inherit their parent's visible SubjectBroker connections. A
  task name or unselected custom-agent file is not a subject boundary. Depths 1 and 2 were
  tested; arbitrary depth and future spawn surfaces with a custom-agent selector remain
  unclassified.
- Runtime and dependency vulnerabilities may invalidate tested assumptions.
- File identity checks do not prove that file contents were never modified in place.
- Authorized rename-replacement updates require a broker restart because file identity is pinned
  for the process lifetime.
- The tests do not establish timing-channel resistance.
