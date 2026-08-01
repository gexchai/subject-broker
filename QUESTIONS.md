# Questions

Status: `draft`

This register maps the former blocking questions to spike evidence. “Answered by spike” means only that the scoped implementation decision has executable evidence; it is not a broader security proof.

## Answered by spike

| Former question | Answer | Decision and evidence |
| --- | --- | --- |
| How is a broker session bound to a subject? | Once at process startup; request identity fields are ignored. | ADR-002; `tests/security/identity-substitution.test.ts` |
| Does audit failure block a read? | Yes, deliberately fail-closed. | ADR-006; `tests/security/audit-failure.test.ts` |
| Is Secure MCP the first transport? | MCP is the transport; Claude Code is the first integration. | ADR-010; `tests/integration/mcp-transport.test.ts` |
| Is resource listing present? | Yes; it lists only identifiers allowed for the bound subject and never content. | ADR-011; `tests/integration/mcp-transport.test.ts` |
| What is the process model? | One stdio server process per bound subject; no daemon. | ADR-008; `tests/integration/mcp-transport.test.ts` |
| How are evaluation and read tied to file identity? | Open with `O_NOFOLLOW`, verify device and inode, then read the same descriptor. | ADR-004; `tests/security/toctou.test.ts` |
| How are configuration and resource replacement changes handled? | Policy and registry identity load at startup; restart to apply configuration or authorized rename-replacement changes; file identity is checked per read. | ADR-008 and ADR-014; `tests/security/toctou.test.ts` |
| What identifiers and reason codes exist? | Stable registered ids and a closed non-sensitive enum. | ADR-003 and ADR-007; `tests/unit/policy.test.ts` |
| Who produces capabilities? | The server reports the active spike scope and uncovered paths. | ADR-011; `tests/unit/capability-report.test.ts` |
| Which subject attributes are required? | Subject id only. | ADR-002 and ADR-005; `tests/unit/policy.test.ts` |
| How are SubjectBroker connections assigned in a multi-agent harness? | The effective authority of an agent context is the union of its visible subject-bound connections. The supported deployment exposes only the connection for that agent's assigned subject. | ADR-018; `docs/field-evidence-2026-07-28.md`, FE-01 |
| Can the FE-01 audit sequence be detected automatically? | Yes, as an offline heuristic: flag a deny followed by an allow for a different subject on the same resource within a configured window. It is not prevention and misses privileged-first calls. | ADR-019; `src/audit-check.ts`; `tests/unit/audit-check.test.ts` |
| Can Hermes native delegation enforce different SubjectBroker subjects for parent and child? | No in Hermes Agent v0.19.0. Native children inherit the parent's effective SubjectBroker authority. Different subjects require separate top-level processes and `HERMES_HOME` profiles. | ADR-020; `docs/integration-hermes.md`; `docs/field-evidence-2026-07-28.md`, FE-02 |
| Can Claude Code enforce different SubjectBroker subjects inside one parent session? | Yes in Claude Code 2.1.220 for a persistent named custom subagent with an explicit MCP `tools` allowlist. Default unfiltered subagents are unsafe; forks and other delegation surfaces are excluded. | ADR-021; `docs/integration-claude-code.md`; `results/claude-code-confirmation/` |
| Can Codex native delegation enforce different SubjectBroker subjects inside one parent session? | No in Codex CLI 0.144.4's tested spawn path. Native children inherit the parent's effective authority. Different subjects require separate top-level processes and `CODEX_HOME` profiles. | ADR-022; `docs/integration-codex.md`; `results/codex-confirmation/` |
| Can OpenCode enforce different SubjectBroker subjects inside one parent project? | Yes in OpenCode 1.18.10 for specifically named subagents with wildcard deny, exact MCP-tool allows, and exact named-child `task` allows at every delegation edge. The built-in `general` child is unsafe. Tested through depth 2. | ADR-024; `docs/integration-opencode.md`; `results/opencode-confirmation/` |
| Is classification required? | No; the spike uses explicit subject-resource-read rules. | ADR-005; `tests/unit/policy.test.ts` |
| What happens with conflicts, missing rules, or incompatible schemas? | Duplicate/invalid policy is a hard failure; absent rules deny. | ADR-005; `tests/security/policy-failure.test.ts` |
| How are indeterminate outcomes exposed? | Reads deny using closed non-sensitive codes; internal policy failure is not an allow. | ADR-005 and ADR-007; `tests/security/policy-failure.test.ts` |
| Is a daemon required? | No for the spike. | ADR-008; `tests/integration/mcp-transport.test.ts` |

## Still open

| Question | Evidence needed to settle it |
| --- | --- |
| Does storage prevent direct same-user reads? | An OS sandbox or separate-privilege integration test showing the agent cannot open the storage path directly. The spike explicitly does not provide this. |
| Are all macOS path edge cases covered, including case aliases and mount replacement? | Additional adversarial tests on supported filesystems and mount configurations. Current evidence covers path-like ids, symlinks, inode replacement, and descriptor verification. |
| Are timing channels acceptably bounded? | A defined leakage threshold and timing-analysis test harness. The current leakage suite checks textual and serialized channels only. |
| Do users understand the capability limitations? | An observed usability test in which developers correctly identify the direct-read limitation before using the integration. |
| Is in-place content mutation during an open read acceptable? | A documented consistency requirement and an attack test for concurrent writes, potentially using snapshots or content hashes. |
| What audit retention or tamper evidence is required? | A concrete operational use case and adversarial retention/integrity tests. A hash-chained log was assessed and parked: it needs an external anchor and one audit file per broker instance, because the current writer and storage share one trust domain and `O_APPEND` concurrency would break under chaining. Any audit schema change is also gated on schema versioning, since `src/audit-check.ts` validates with a `.strict()` schema. See [protocol and ecosystem watch](docs/protocol-watch.md). |
| Which MCP protocol revision does the broker implement, and what changes under revision 2026-07-28? | Current baseline: revision `2025-11-25` through `@modelcontextprotocol/sdk` 1.29.0. Migrating to the official modular v2 packages requires a deliberate package/API change and a re-run of the transport and confirmation suites. Assessed with no immediate action required: stdio is retained and existing evidence stays valid because it is version-pinned. One open risk is recorded — `tools/list` results must be emitted with `cacheScope: "private"` because tool descriptions embed the bound subject. See [protocol and ecosystem watch](docs/protocol-watch.md). |
| Is encryption at rest needed? | A storage threat requiring protection beyond host filesystem controls, plus key-management requirements. |
| Can VS Code local Copilot custom subagents enforce a narrower SubjectBroker MCP tool set than their parent? | The VS Code 1.130.0 / built-in Copilot 0.58.0 run was blocked before delegation: the custom-agent MCP selector did not materialize in the parent model request, so C1 could not pass. Re-run on a later version only after the debug tool schema contains the selected MCP tool and the parent produces a broker allow. See `docs/field-test-vscode-copilot-subagent-isolation.md`. |
| Which adapter follows Claude Code? | Hermes, native Pi, Codex CLI 0.144.4, OpenCode 1.18.10, and the blocked VS Code local Copilot 1.130.0 setup have been classified to the extent their shipped mechanisms allow. Gemini CLI remains deferred until user demand justifies it; no next harness is currently selected. |
| How should capability schema versions interoperate? | A second implementation or version plus compatibility tests. |
| Should remote or team policy management exist? | Validated multi-user requirements and a new threat model; it is outside this spike. |
