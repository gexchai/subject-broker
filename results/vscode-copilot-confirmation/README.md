# VS Code local Copilot confirmation results

Status: `blocked at C1 on VS Code 1.130.0 / built-in GitHub Copilot 0.58.0`.

No accepted matrix case exists. The parent positive control could not place its selected MCP tool
in the Copilot model request, so the subagent cases were not run.

Retained setup evidence:

- `invalid-c1-tool-discovery/`: both broker processes originally reported the same MCP
  implementation name, so neither distinct selector resolved;
- `invalid-c1-delegation-control/`: the delegation-capable control agent ignored a prompt-only
  no-delegation instruction;
- `invalid-c1-stale-agent-tool-snapshot/`: the attempted direct control received a tool schema
  containing only `session_store_sql`, with no SubjectBroker MCP tool;
- `blocked-c1-custom-agent-mcp-tool-resolution/`: reloading the custom agent reset Configure
  Tools to zero selected MCP tools even though its frontmatter retained the exact selector.

The empty audit files are intentional evidence that neither broker received a read during those
invalid or blocked controls. `tools-offered.json` is the minimized, reviewed tool schema from the
blocked request; no raw chat/debug export is retained.

For a future version, the fixture capture script creates one directory per accepted case. Each
completed case must contain:

```text
case.txt
audit-orchestrator.jsonl
audit-worker.jsonl
chat.json
agent-debug.otlp.json
```

Before any future accepted-result commit, add a version record, normalize local paths, scan exports for
credentials and unrelated user context, and write `RESULTS.md`. Do not retain raw debug exports
until that review is complete.
