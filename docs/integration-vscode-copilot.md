# VS Code local Copilot integration

Status: `field-tested setup, blocked before C1 on VS Code 1.130.0 / built-in GitHub Copilot
0.58.0`.

The candidate in-session topology uses a VS Code custom parent agent with both SubjectBroker
connections and a named worker subagent whose `tools` allowlist contains only
`sbWorker/read_resource`.
Official VS Code documentation says custom subagent settings override inherited tools, but this
project does not treat that statement as evidence until the confirmation protocol is executed.

VS Code 1.130.0 groups MCP tools for custom-agent selection by the implementation name reported
during MCP initialization, not merely by the key in `.vscode/mcp.json`. Each SubjectBroker
process in this topology therefore uses a distinct `--server-name` (`sbOrchestrator` or
`sbWorker`). The name is a host-visible routing label, not an authority claim; the corresponding
`--subject` remains the security binding. Reusing the default `subject-broker` name for both
processes makes the two connections ambiguous in Configure Tools and invalidates this topology.
The fixture names the exact `read_resource` tools instead of relying on server wildcards, keeping
the field test's authority surface to the single operation under test.

Treat MCP startup order as part of the integration. In the observed VS Code 1.130.0 session,
stopping a server removed its dynamically discovered tools from the active custom-agent
selection, and restarting it did not automatically restore those selections from frontmatter.
After every restart, use Configure Tools to select and save the exact entries for each agent that
will run, then reopen the dialog and verify the count before sending a prompt.

That workaround was not sufficient in the pinned field run. Configure Tools temporarily showed
`1 Selected`, but the next parent model request's retained tool schema contained no SubjectBroker
MCP tool. Reloading the custom agent then returned the dialog to `0 Selected` even though its
frontmatter still named the exact tool. The broker audits remained empty because no broker call
was attempted.

Consequently, this version-pinned local Copilot topology is not deployable as an in-session
SubjectBroker isolation integration. It is **unclassified for subagent isolation**, because the
parent positive control failed before delegation. Do not interpret the missing call as
enforcement. A later VS Code/Copilot version must first pass C1 by placing
`sbOrchestrator/read_resource` in the parent request's debug tool schema and producing the
matching orchestrator audit allow.

The direct positive control uses a separate `SB Direct Parent` without the `agent` tool. Prompt
text did not reliably prevent a delegation-capable parent from delegating, so a direct-control
claim must be established by removing delegation from the control agent rather than instructing
the model not to use it.

Use the isolated fixture:

```bash
sh fixtures/vscode-copilot/scripts/prepare-fixture.sh
code fixtures/vscode-copilot/project
```

Do not copy the fixture MCP configuration into a normal development workspace. Do not present
the allowlist as enforcement before
[`field-test-vscode-copilot-subagent-isolation.md`](field-test-vscode-copilot-subagent-isolation.md)
passes its evidence gate.

SubjectBroker does not prevent direct filesystem or terminal access. The fixture agent
allowlists omit those tools so this experiment measures MCP visibility; an OS sandbox is still
required to close direct same-user reads in a real deployment.

Relevant VS Code documentation:

- [Subagents](https://code.visualstudio.com/docs/agents/subagents)
- [Custom agents](https://code.visualstudio.com/docs/agent-customization/custom-agents)
- [MCP configuration](https://code.visualstudio.com/docs/agents/reference/mcp-configuration)
- [Agent Debug Logs](https://code.visualstudio.com/docs/agents/agent-troubleshooting/chat-debug-view)
