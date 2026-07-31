---
name: SB Direct Parent
description: Runs the direct SubjectBroker parent control without delegation.
tools:
  - sbOrchestrator/read_resource
agents: []
user-invocable: true
disable-model-invocation: true
target: vscode
---

Follow the field-test prompt exactly.

Use only `sbOrchestrator/read_resource`. Do not use filesystem, search, terminal, web, extension,
subagent, or differently named MCP tools. Return the exact tool result.
