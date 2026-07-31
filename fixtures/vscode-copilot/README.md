# VS Code local Copilot subagent fixture

This fixture reproduces the version-pinned field test in
[`docs/field-test-vscode-copilot-subagent-isolation.md`](../../docs/field-test-vscode-copilot-subagent-isolation.md).
It does not run Copilot or create an accepted result by itself.

The 2026-07-31 run was blocked before C1 on VS Code 1.130.0 with built-in GitHub Copilot 0.58.0:
the custom-agent MCP selector could be shown as selected temporarily, but the MCP tool was absent
from the model request and the selection disappeared when the agent was reloaded. Do not spend
credits on C2–C4 in that version unless C1 first produces a real orchestrator audit allow.

Open only `fixtures/vscode-copilot/project` as the VS Code workspace. Its workspace MCP
configuration starts two SubjectBroker processes:

- `sbOrchestrator`, bound to `orchestrator`, which may read `secret`;
- `sbWorker`, bound to `worker`, which is denied `secret`.

Both the configuration keys and the MCP-reported server names are distinct. VS Code 1.130.0 uses
the reported names in custom-agent tool selection; configuration keys alone did not make the
connections selectable as `sbOrchestrator/*` and `sbWorker/*`.

`SB Direct Parent` exists only for C1 and has no delegation tool. `SB Parent` retains delegation
for the named-worker cases; prompt text alone did not stop that agent from delegating during the
first direct-control attempt.

The protected file is generated under `/private/tmp/subject-broker-vscode-copilot/`, outside the
workspace. The policy and audit files are generated below the fixture project and ignored by Git.

Prepare the fixture from the repository root:

```bash
sh fixtures/vscode-copilot/scripts/prepare-fixture.sh
code fixtures/vscode-copilot/project
```

Before each case, stop both fixture MCP servers in VS Code and run:

```bash
sh fixtures/vscode-copilot/scripts/prepare-case.sh c1-parent-control
```

Restart both servers, run exactly one case prompt, stop both servers, then capture the broker
audits:

```bash
sh fixtures/vscode-copilot/scripts/capture-case.sh c1-parent-control
```

Export the Chat JSON and Agent Debug OTLP JSON into the case directory printed by the capture
script. Do not reuse a chat session or audit file across cases.

After restarting the servers and before sending a prompt, open Configure Tools for every agent
used by that case and save the exact frontmatter entries. Reopen it to verify the selected count.
VS Code 1.130.0 removed dynamically discovered MCP tools from active custom-agent selections when
the servers stopped and did not restore them automatically in the observed session. This manual
step was not enough to place the tool in the model request in the pinned run; use the Copilot
debug tool schema and broker audit, not the checkbox alone, as the positive-control evidence.
