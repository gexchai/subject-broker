# Security policy

SubjectBroker is an experimental research prototype. It is not a production security boundary,
an agent sandbox, or a promise that third-party harnesses isolate delegated agents.

## Supported versions

There is no production-supported release.

| Version | Security updates |
| --- | --- |
| Current `main` / latest pre-release | Best-effort fixes for the documented research scope |
| Older commits or snapshots | Not supported |

The tested platform is macOS. See the [threat model](THREAT_MODEL.md) and
[architecture decisions](DECISIONS.md) before evaluating a potential vulnerability.

## Report a vulnerability privately

After the public repository is created, private vulnerability reporting should be enabled in
GitHub repository settings.

Use the repository's **Security → Report a vulnerability** form for reports that could expose
protected content, bypass a documented broker control, or provide a working exploit.

If private vulnerability reporting is not available, open a public issue containing only a
request for a private reporting channel. Do not include exploit details, credentials, sensitive
paths, protected content, or a live canary in that issue.

Please include privately:

- the affected commit or release;
- macOS, Node.js, MCP client, and agent-harness versions;
- the documented security property you believe is violated;
- a minimal reproduction using synthetic data;
- the observed and expected result;
- whether direct filesystem, shell, network, browser, or credential access was available; and
- any suggested remediation or disclosure constraint.

Do not test against systems, accounts, or data you do not own or have explicit permission to
use.

## In-scope examples

- A denied `read_resource` request returns protected content.
- Request input can replace the process-bound subject identity.
- A registered resource escapes the configured storage root through the covered broker path.
- Audit failure releases content instead of failing closed.
- Symlink or file-replacement handling defeats a documented macOS broker guarantee.
- Protected content appears in a denial, error, startup diagnostic, explanation, or audit event.
- The capability report claims an enforcement property that the active implementation does not
  provide.

## Known limitations and out-of-scope reports

The following are documented limitations, not new broker vulnerabilities by themselves:

- direct filesystem, shell, network, clipboard, browser, credential, or process access;
- absence of OS-level sandboxing or mandatory routing through SubjectBroker;
- a third-party harness exposing multiple subject-bound connections to one agent context;
- version-pinned Claude Code, Codex, Hermes, or Pi behavior already recorded in the integration
  guides;
- denial-of-service through resources unavailable to the local operating-system user;
- unsupported non-macOS hard-enforcement claims; and
- social-engineering or prompt-injection reports that do not bypass a documented technical
  control.

Reports showing that a documented limitation is broader than stated, or that documentation
materially overclaims the implementation, are welcome.

## Response and disclosure

This is a volunteer project with no guaranteed response time, service-level agreement, bug
bounty, or production support. The maintainer will aim to acknowledge a complete private report,
validate the affected scope, and coordinate disclosure before publishing exploit details.

Please do not publicly disclose an unpatched vulnerability before a reasonable coordination
attempt.
