# Protocol and ecosystem watch

Status: `notes` — reviewed impact assessments, not decisions. Nothing here has been implemented,
and nothing here creates a guarantee. Items become work only when promoted to `DECISIONS.md` by
the project owner.

Current implementation baseline: `@modelcontextprotocol/sdk` 1.29.0, MCP revision `2025-11-25`,
stdio transport only.

## MCP revision 2026-07-28 — assessed 2026-07-30

Source: [changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog) and the
[announcement](https://claude.com/blog/bringing-mcp-2026-07-28-to-claude).

### Assessment: no immediate action

- The stdio transport is retained, and is explicitly named as the backward-compatibility probe
  path for the new `server/discover` RPC. ADR-008's per-process stdio model is unaffected.
- The deprecated transport is HTTP+SSE, which this project has never used.
- The project uses the legacy monolithic `@modelcontextprotocol/sdk` package. Its latest release
  is 1.30.0 and does not implement this revision. The
  [official modular TypeScript SDK v2 packages](https://github.com/modelcontextprotocol/typescript-sdk/releases)
  have shipped at 2.0.0 with 2026-07-28 support, but adoption requires a deliberate package and
  API migration rather than a drop-in dependency update. Most items below are SDK-mediated
  rather than broker code changes.
- Retained field evidence in `results/` remains valid because every claim is version-pinned.

### Confirms existing decisions

| Revision change | Existing decision it confirms |
| --- | --- |
| Logging feature deprecated; suggested migration is "log to `stderr` (stdio) or use OpenTelemetry" | ADR-017's non-sensitive stderr diagnostic channel |
| Roots deprecated; suggested migration is passing files via tool parameters, resource URIs, or **server configuration** | ADR-003 (registered ids, never caller-supplied paths) and startup-loaded policy |
| `tools/list` SHOULD return tools in deterministic order | Four tools registered in fixed order; `ResourceRegistry.ids()` already sorts |

### Open risk — `cacheScope` on list results

The revision adds required `ttlMs` and `cacheScope` (`"public"` or `"private"`) fields to
`tools/list` results, where `"public"` permits shared intermediaries to cache the response.

`src/mcp-server.ts` embeds the bound subject in all four tool descriptions
(`This connection is bound to subject "<subjectId>"...`, added under ADR-018 as defense in
depth). A subject-specific tool list cached as `"public"` could therefore be served from a shared
cache to a client bound to a different subject.

If this revision is adopted, `tools/list` results must be emitted with `cacheScope: "private"`.
This is a consequence of the ADR-018 tool-description text and should be checked at the same time
that text is reviewed.

### Deferred items to verify on any SDK upgrade or v2 migration

- `server/discover` becomes a server **MUST**; `initialize` and `notifications/initialized` are
  removed. Confirm the SDK implements the RPC rather than assuming it.
- All results carry a required `resultType` field (`"complete"` or `"input_required"`). Results
  are hand-constructed in `textResult()`; confirm the SDK populates it. Backward compatibility
  exists: clients must treat a missing field as `"complete"`.
- Error codes renumbered, with `-32020`–`-32099` reserved for the specification. Low impact: this
  project exposes a closed reason-code enum inside tool results rather than JSON-RPC error codes.
- `inputSchema`/`outputSchema` loosened to arbitrary JSON Schema 2020-12, and `structuredContent`
  to any JSON value. Permissive; no known conflict with current tool input schemas.

### Candidate improvement — record the protocol revision in the capability report

`createCapabilityReport` reports `version` (spike version) and `platform`, but not which MCP
protocol revision the broker implements or was tested against. Because every other claim in this
project is version-pinned, and because MCP has now shipped a revision with breaking changes, the
capability report arguably should state the revision explicitly.

### Watch items — no action, revisit only if the transport changes

- **Statelessness direction.** The revision removes protocol-level sessions and the
  `Mcp-Session-Id` header, and states that servers needing cross-call state should use explicit
  server-minted handles passed as ordinary tool arguments. Server-minted handles are consistent
  with ADR-002 (server-generated values are trusted; request-supplied identity is not). However
  ADR-008 (per-process), ADR-014 (device/inode pinned for the process lifetime), and ADR-020,
  ADR-021, and ADR-022 all depend on "one process per subject", which is inexpensive over stdio
  and awkward under stateless or serverless hosting. This matters only if the project leaves
  stdio, which ADR-008 currently rules out.
- **Authorization hardening.** Alignment with OAuth 2.0/OIDC, and Client ID Metadata Documents
  replacing Dynamic Client Registration, would be a legitimate mechanism for selecting a subject
  from an operator-controlled endpoint *if* a remote transport is ever added. It must not be used
  to derive the subject from a client-presented token: a token the agent holds is a bearer
  credential the agent can copy or reuse, which is weaker than process binding. See the parked
  Nostr assessment below for the same objection in another form.

### Related opportunity — Multi Round-Trip Requests and request-time approval

SEP-2322 introduces `InputRequiredResult` (`resultType: "input_required"`, with an
`inputRequests` field); the client retries the original request carrying `inputResponses`. This is
a protocol-native primitive for a request-time human-approval step, which would otherwise need an
invented side channel.

Honest limitation, and the reason this is not a security control: the input request is mediated by
the client harness. A harness that auto-answers, or one running in an autonomous approval mode
(`--yolo`, `bypassPermissions`), can satisfy it with no human involved. That is the same class of
limitation as the ADR-018 tool descriptions and the same lesson as finding FE-02. If approval is
built on MRTR, it is a usability mechanism, and an out-of-band approval path remains the control.

## Parked — Nostr and Buzz assessment, 2026-07-30

Reviewed [nostr-protocol/nostr](https://github.com/nostr-protocol/nostr) and
[block/buzz](https://github.com/block/buzz) for transferable ideas. **Parked: the reviewed items
did not justify the added surface area for this spike.** Recorded so the reasoning is not
re-derived.

### Why the hash-chained audit log was not adopted

Buzz chains SHA-256 over sequence, timestamp, actor, action, canonical metadata, and the previous
hash. Its own architecture document scopes the guarantee precisely: the chain protects against
storage-layer tampering, *not* against a compromised writer, because the writer computes and
stores the chain and could recompute it.

That separation does not exist here. One broker process appends to a local file that the same
trusted owner controls, so the adversary such a chain would detect is either the project owner or
an agent with direct filesystem access — both already out of scope in `THREAT_MODEL.md`, and the
latter can read the protected file directly without using the broker at all.

Two further blockers, if it is ever reconsidered:

- **It conflicts with the current concurrency model.** Audit appends are `O_APPEND` plus one line
  plus `fsync`, which is why concurrent multi-process appends interleave safely and why separate
  broker processes can share one audit file. Chaining requires reading the previous hash before
  each write, so two processes can read the same predecessor and both claim the same sequence
  number. Buzz needs an advisory lock for exactly this. Chaining would first require one audit
  file per broker instance, or explicit locking.
- **Real tamper evidence needs an external anchor** — an append-only sink outside owner control,
  external notarization, or a signing key neither the owner nor the agent can reach. That is a
  deployment change, not additional event fields.

### Prerequisite for any future audit schema change

`src/audit-check.ts` validates audit records with a `.strict()` schema, so **any** added field
causes existing verifiers to reject newer logs. Audit schema versioning is therefore a
prerequisite for every future audit format change, including the `brokerInstanceId` idea below.

### The one item judged worth doing eventually

`brokerInstanceId` (plus the schema version above). The audit checker merges multiple files and
tracks the source file path, but events themselves carry no instance identity, so two `worker`
processes started with different policies emit identical records. This is the multi-log
investigation problem that finding FE-02 exposed. This item does not depend on Nostr or Buzz.

A broker-computed `requestDigest` is a weaker second candidate. Any lineage identifiers supplied
by the caller (`operationId`, `parentOperationId`, `delegationId`) were rejected: they originate
from the agent, which ADR-002 exists to distrust, and an agent concealing an escalation would
simply omit or forge them.

### Explicitly not adopted

Nostr federation and multiple relays; WebSocket subscriptions and live fan-out; agent-held public
keys as authorization identity; channel membership as the permission model; a general event store,
search, workflow, or chat surface; asynchronous best-effort auditing; Nostr wire compatibility.
Nostr's permissive "ignore event kinds you do not understand" guidance also conflicts with
ADR-005 and ADR-007: an audit verifier must fail closed on unrecognized records rather than skip
them.

Auditing non-read events (`broker.started`, `policy.loaded`, `capability.report`) would reopen
ADR-012, whose stated reason for exclusion — undefined failure semantics — remains unanswered.
Decide what a failed `policy.loaded` audit write should do before adding event kinds.

## Also outstanding — unrelated to protocol changes

The first row of `QUESTIONS.md` remains the load-bearing gap: nothing in this project closes the
direct-read path. A tested OS-sandbox pairing would change whether the broker is useful at all,
whereas a richer audit envelope or a newer protocol revision would not.
