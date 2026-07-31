---
name: SB Parent
description: Runs the SubjectBroker VS Code subagent isolation controls.
tools:
  - agent
  - sbOrchestrator/read_resource
  - sbWorker/read_resource
agents:
  - SB Restricted Worker
user-invocable: true
disable-model-invocation: true
target: vscode
---

Follow the field-test prompt exactly.

Use only the named SubjectBroker MCP tool or subagent. Do not use filesystem, search, terminal,
web, extension, or differently named MCP tools. Do not substitute one SubjectBroker connection
for another. Report exact tool results and harness errors.
