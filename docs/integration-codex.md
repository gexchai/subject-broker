# Codex integration

Status: `field-tested` for Codex CLI 0.144.4 native delegation.

SubjectBroker cannot stop Codex from using direct filesystem or shell access. Use an OS-level
sandbox or separate operating-system identity when the protected storage path must be
inaccessible outside MCP.

## Supported subject topology

Codex native children inherit the SubjectBroker connections available to their parent in the
tested version. Do not place worker and orchestrator connections in one Codex process and expect
delegation to create a subject boundary.

For different subjects, use separate top-level Codex processes with separate `CODEX_HOME`
profiles. Each profile must configure exactly one subject-bound SubjectBroker connection. Native
delegation is then safe only for children intended to have that same subject authority.

```text
orchestrator CODEX_HOME             worker CODEX_HOME
└── sb-orchestrator only            └── sb-worker only
    └── same-authority children         └── same-authority children
```

The worker-side `config.toml` shape is:

```toml
[mcp_servers.sb-worker]
command = "node"
args = [
  "/absolute/path/to/subject-broker/dist/server.js",
  "--policy",
  "/absolute/path/to/subject-broker.yaml",
  "--subject",
  "worker",
  "--audit",
  "/absolute/path/to/audit-worker.jsonl",
  "--max-bytes",
  "1048576",
]
required = true
default_tools_approval_mode = "approve"
```

Keep the orchestrator connection out of this profile entirely. Do not rely on instructions,
tool descriptions, task names, or the offline audit checker to turn a two-connection parent into
a restricted child.

## Version caveat

The tested Codex 0.144.4 `spawn_agent` surface did not expose a custom-agent type or per-child
MCP filter. A file that disables an inherited server is not an isolation control unless the
harness actually provides and exercises a selector that loads that file for the spawned child.

Re-run [`field-test-codex-subagent-isolation.md`](field-test-codex-subagent-isolation.md) when a
future Codex release exposes such a selector. A positive result must retain child-parent session
linkage, a worker positive control, a privileged-first attempt, and broker-side audit evidence.

The worker-only profile was exercised through a child and grandchild (delegation depth 2).
Do not infer arbitrary-depth behavior from that bounded result.

See ADR-018, ADR-022, and the
[retained Codex results](../results/codex-confirmation/RESULTS.md).
