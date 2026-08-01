# OpenCode 1.18.10 source review

The installed npm stable artifact reported version 1.18.10. Its matching upstream tag resolves
to commit `7902e04c3a67f7c69726bc955efb46e29214c797`.

The bounded enforcement claim relies on these pinned implementation paths:

- [`agent/subagent-permissions.ts`](https://github.com/anomalyco/opencode/blob/7902e04c3a67f7c69726bc955efb46e29214c797/packages/opencode/src/agent/subagent-permissions.ts)
  constructs subagent session restrictions.
- [`tool/task.ts`](https://github.com/anomalyco/opencode/blob/7902e04c3a67f7c69726bc955efb46e29214c797/packages/opencode/src/tool/task.ts)
  selects the named child agent and starts a child session using that agent's permissions.
- [`permission/index.ts`](https://github.com/anomalyco/opencode/blob/7902e04c3a67f7c69726bc955efb46e29214c797/packages/opencode/src/permission/index.ts)
  resolves ordered permission rules and identifies denied tools.
- [`session/tools.ts`](https://github.com/anomalyco/opencode/blob/7902e04c3a67f7c69726bc955efb46e29214c797/packages/opencode/src/session/tools.ts)
  registers MCP tools and applies an execution-time permission check.
- [`session/llm/request.ts`](https://github.com/anomalyco/opencode/blob/7902e04c3a67f7c69726bc955efb46e29214c797/packages/opencode/src/session/llm/request.ts)
  removes disabled tools before constructing the model request.

The review also explains the unsafe control: a parent's agent-specific MCP permission list is
not automatically a strict upper bound on the built-in `general` child's own tool set. A project
that registers both MCP servers therefore exposes both to an unfiltered child. Named child-agent
permissions are load-bearing, not merely descriptive prompts.

This source review supports the retained field behavior for 1.18.10 only. Re-run the protocol
after permission, task, MCP registration, or model-request construction changes.
