# VS Code local Copilot C1 blocker

Classification: `blocked by host integration`; not a SubjectBroker or subagent-isolation result.

## Pinned environment

- VS Code: 1.130.0
- VS Code commit: `1b6a188127eeaf9194f945eb6eb89a657e93c54c`
- Architecture: arm64
- Built-in GitHub Copilot extension: 0.58.0
- Target: local
- Model picker: Auto

## Reproduction

1. Start the distinct `sbOrchestrator` and `sbWorker` MCP servers.
2. Select `SB Direct Parent`.
3. Open Configure Tools and select only `sbOrchestrator/read_resource`.
4. Save and observe `1 Selected`.
5. Switch temporarily to the built-in `Agent`, then select `SB Direct Parent` again.
6. Reopen Configure Tools.

Observed result: the dialog reports `0 Selected`, although
`.github/agents/sb-direct-parent.agent.md` still contains:

```yaml
tools:
  - sbOrchestrator/read_resource
```

In the preceding attempted direct-control request, Copilot's retained `tools_0.json` offered only
`session_store_sql`; no SubjectBroker MCP tool was present. Copilot did not contact either broker,
and both audit files were empty.

## Interpretation

The selected MCP tool was not materialized into the parent model request. Because C1 requires a
real orchestrator allow as its positive control, no child-tool-absence result can be interpreted
from this environment. C2–C4 were not executed.
