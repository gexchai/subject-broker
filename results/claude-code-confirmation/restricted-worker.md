---
name: restricted-worker
description: Tests worker-only ContextGuard access
tools:
  - mcp__cg-worker__list_resources
  - mcp__cg-worker__read_resource
  - mcp__cg-worker__explain_decision
  - mcp__cg-worker__capability_report
---

Use only the worker-bound ContextGuard tools. Report tool failures exactly.
