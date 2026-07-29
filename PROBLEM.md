# Problem

Status: `decided`

## Concrete scenario

A developer runs a coding agent in a project containing ordinary source code alongside material that should be released only after an explicit decision, such as credentials, customer data, or contract terms.

Today, the common choices are:

1. give the agent access to the working environment and risk exposing all readable material; or
2. manually remove, relocate, or redact files before each agent session.

The first choice can release sensitive content without a deliberate decision. The second is fragile, interrupts work, and is difficult to audit. Copies in prompts, logs, caches, or forgotten paths can make either workflow misleading.

## Observable harm

The harm is observable when protected bytes reach an agent or provider without a policy decision the developer intended to require. Secondary harms include:

- no durable record of why content was released;
- identity substitution that evaluates a request as a more trusted agent;
- malformed resource identifiers escaping an intended directory;
- denied content leaking through errors, explanations, or audit logs;
- developers believing a cooperative integration prevents direct filesystem access.

## What better looks like

For resources deliberately placed behind the broker:

- the agent requests a stable resource identifier;
- the process-bound subject cannot be replaced by request data;
- an explicit subject-resource-action rule produces allow or deny;
- deny and error paths return no protected bytes;
- every brokered read outcome is logged without content;
- the integration reports exactly what it covers and which direct paths remain open.

The spike is better only for this brokered path. It is not better if documentation implies that it prevents an unrestricted agent from reading the source file directly.

## Explicit assumptions

- **Assumption:** the developer is willing to register selected resources and keep their paths outside the agent working tree.
- **Assumption:** the developer controls server startup, policy, registry entries, and audit destination.
- **Assumption:** a cooperative or confused/injected agent uses the MCP broker for the resources being evaluated.
- **Assumption:** the macOS host and SubjectBroker process are not compromised.
- **Assumption:** content already released by an allow decision is outside SubjectBroker's control.

These assumptions are not verified facts about every coding-agent deployment.
