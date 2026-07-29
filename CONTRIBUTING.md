# Contributing to SubjectBroker

Thanks for helping improve SubjectBroker. This project values narrow claims, executable evidence,
and explicit security boundaries over feature breadth.

## Before you start

- Read the [README](README.md), [threat model](THREAT_MODEL.md), and
  [architecture decisions](DECISIONS.md).
- Search existing issues and open questions before proposing a duplicate.
- Use synthetic fixtures only. Never contribute real credentials, customer data, private
  transcripts, or protected content.
- Report potential vulnerabilities through [SECURITY.md](SECURITY.md), not a public issue.

For a substantial policy, storage, audit, identity, or enforcement change, open an issue first so
the intended security claim can be agreed before implementation.

## Development setup

Requirements:

- macOS;
- Node.js 20 or newer; and
- npm.

```bash
npm ci
npm run demo
npm test
```

The full test command builds the TypeScript project and runs all unit, integration, and security
tests.

## What makes a useful change

Good contributions include:

- a minimal failing test for a broker security property;
- a fix that preserves fail-closed behavior;
- a version-pinned agent-harness integration result;
- a clearer boundary or correction to an overbroad claim;
- a reproducible synthetic fixture; or
- documentation that helps users deploy one visible subject per agent context.

Avoid combining unrelated refactors with a security fix or field-test result.

## Security-sensitive implementation rules

- Keep subject identity process-bound; do not accept it from a read request.
- Keep policy evaluation default-deny.
- Never return protected bytes before a successful audit write.
- Use registered resource IDs rather than caller-supplied paths.
- Do not add protected content to errors, explanations, diagnostics, or audit metadata.
- Treat tool descriptions and prompts as defense-in-depth, not enforcement.
- Do not expand a capability claim without executable evidence.

If a change intentionally alters one of these rules, update the threat model and add or amend an
ADR in the same pull request.

## Field evidence

Follow the relevant protocol under `docs/field-test-*.md`.

Public evidence must follow [results/README.md](results/README.md):

- retain the exact synthetic prompt, relevant normalized events, normalized configuration,
  version, and fresh broker audits;
- replace opaque identifiers with stable actor labels;
- remove account, machine, plugin, token-usage, thinking-signature, and unrelated provider
  metadata; and
- record SHA-256 hashes of private source artifacts before minimization.

Do not classify model prose alone as tool isolation. Include a positive control and
harness- or broker-authored evidence.

## Pull requests

Before opening a pull request:

```bash
npm run demo
npm test
npm audit --omit=dev
```

Also check the diff for credentials, absolute personal paths, raw session identifiers, and
unrelated generated output.

A pull request should explain:

- the problem and scope;
- the security properties affected;
- the tests or field controls added;
- the documentation or ADR changes required; and
- known limitations that remain.

Small, reviewable pull requests are preferred.

GitHub Actions repeats the demo, test suite, and high-severity production dependency audit on a
clean macOS runner for every pull request and push to `main`. A green workflow is required
evidence that the change does not depend only on local machine state.

## License

By submitting a contribution, you agree that it may be distributed under the repository's
[Apache License 2.0](LICENSE).
