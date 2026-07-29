# Claude Code integration

Status: `field-tested` for Claude Code 2.1.220. Persistent named custom subagents with explicit
MCP tool allowlists are the supported in-session distinct-subject topology.

This connects Claude Code to the SubjectBroker stdio MCP server. It does not stop Claude Code from using shell or filesystem tools to read the storage path directly. Use OS-level sandboxing if that path must be closed.

## Subject isolation requirement

An unfiltered Claude Code context's effective authority is the union of every visible
SubjectBroker connection. SubjectBroker cannot enforce MCP tool visibility inside Claude Code.

**Claude Code is not safe by default for distinct subjects.** The confirmation run proved that
an ordinary unfiltered subagent inherited the parent's orchestrator connection, called it, and
received the synthetic canary.

The supported in-session topology uses a persistent named custom subagent whose `tools` field is
an explicit allowlist containing only the assigned subject's SubjectBroker tools. This is a
configuration-dependent Claude Code control, not a broker capability. It does not apply to
ordinary unfiltered subagents, forks, agent teams, nested delegation, or direct filesystem and
shell paths.

See ADR-018, ADR-021, [field evidence FE-01 and FE-03](field-evidence-2026-07-28.md), and
[the retained confirmation results](../results/claude-code-confirmation/RESULTS.md).

## Verified restricted-worker definition

When a parent session must hold both `sb-orchestrator` and `sb-worker`, define the worker at
`.claude/agents/restricted-worker.md`:

```markdown
---
name: restricted-worker
description: Worker with only worker-bound SubjectBroker access
tools:
  - mcp__cg-worker__list_resources
  - mcp__cg-worker__read_resource
  - mcp__cg-worker__explain_decision
  - mcp__cg-worker__capability_report
---

Use only the worker-bound SubjectBroker tools. Report tool failures exactly.
```

The server and tool names must match the actual MCP configuration. Treat a missing or misspelled
allowlist as a deployment failure; do not fall back to an ordinary subagent.

For distinct subjects:

- invoke the named `restricted-worker`, not a default `general-purpose` child;
- do not use `/subtask` forks as worker identities;
- do not assume Agent Teams or nested children share this result without separate evidence;
- retain one subject-bound connection per custom subagent allowlist;
- keep direct file and shell access outside the claimed enforcement boundary.

## Prepare the synthetic fixture

From the SubjectBroker repository:

```bash
npm install
npm run build

export SUBJECT_BROKER_REPO="$(pwd)"
export SUBJECT_BROKER_FIXTURE="$SUBJECT_BROKER_REPO/fixtures/claude-code"
export SUBJECT_BROKER_POLICY="$SUBJECT_BROKER_FIXTURE/project/subject-broker.yaml"
export SUBJECT_BROKER_AUDIT="$SUBJECT_BROKER_FIXTURE/project/subject-broker-audit.jsonl"
chmod 700 "$SUBJECT_BROKER_FIXTURE/protected-storage"

printf '%s\n' \
  'version: 1' \
  "storageRoot: $SUBJECT_BROKER_FIXTURE/protected-storage" \
  'subjects:' \
  '  - claude-code' \
  'resources:' \
  '  synthetic-contract:' \
  "    path: $SUBJECT_BROKER_FIXTURE/protected-storage/customer-contract.txt" \
  'rules:' \
  '  - subject: claude-code' \
  '    resource: synthetic-contract' \
  '    action: read' \
  '    decision: allow' \
  > "$SUBJECT_BROKER_POLICY"
```

Launch Claude Code from `fixtures/claude-code/project`, not from the storage directory.

## Project `.mcp.json`

Create `fixtures/claude-code/project/.mcp.json`:

```json
{
  "mcpServers": {
    "subject-broker": {
      "type": "stdio",
      "command": "node",
      "args": [
        "${SUBJECT_BROKER_REPO}/dist/server.js",
        "--policy",
        "${SUBJECT_BROKER_POLICY}",
        "--subject",
        "claude-code",
        "--audit",
        "${SUBJECT_BROKER_AUDIT}",
        "--max-bytes",
        "1048576"
      ]
    }
  }
}
```

The exported variables must be present in the environment that launches Claude Code.

## Equivalent Claude CLI command

Run this from `fixtures/claude-code/project`:

```bash
claude mcp add --transport stdio --scope project subject-broker -- \
  node "$SUBJECT_BROKER_REPO/dist/server.js" \
  --policy "$SUBJECT_BROKER_POLICY" \
  --subject claude-code \
  --audit "$SUBJECT_BROKER_AUDIT" \
  --max-bytes 1048576
```

The size flag is optional and defaults to 1 MiB. Resources must contain valid UTF-8. Restart the
Claude Code MCP connection after an authorized atomic save of a registered resource so
SubjectBroker can register the new file identity.

Verify the connection with:

```bash
claude mcp get subject-broker
```

Then use `/mcp` inside Claude Code and confirm that exactly four SubjectBroker tools are shown.

Claude Code's current MCP configuration syntax is documented in the [official MCP guide](https://code.claude.com/docs/en/mcp).
