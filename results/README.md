# Retained field evidence

This directory contains public, minimized evidence for version-pinned agent-harness field tests.
It is intended to support the repository's bounded integration claims without publishing
unrelated account, machine, plugin, session, or model-provider metadata.

SubjectBroker was developed under the former working name **ContextGuard**. This directory
intentionally preserves that name and the original `cg-*` connection labels in retained evidence
so the public extracts continue to match their private source artifacts and provenance hashes.

Each accepted case retains the smallest useful combination of:

- the exact synthetic prompt;
- a normalized event sequence showing actor relationships and relevant tool activity;
- fresh broker audit files;
- normalized harness and ContextGuard configuration;
- the tested harness version; and
- SHA-256 hashes of the private source artifacts from which the public extracts were derived.

## Normalization boundary

`events.normalized.jsonl` is a curated extract, not a raw harness transcript. It removes:

- session, request, message, hook, tool-call, and thread identifiers;
- timestamps, latency, token usage, and model-routing metadata;
- local paths and account/authentication metadata;
- installed plugins, skills, commands, and unrelated tool inventory;
- thinking blocks, signatures, encrypted delegated messages, and unrelated prose; and
- repeated stdout/stderr copies of the same result.

It preserves:

- whether the actor was the parent, child, or grandchild;
- the selected agent type where it is load-bearing;
- spawn and parent-child relationships;
- relevant tool searches, tool availability, calls, and structured outcomes;
- the count of relevant tool calls when absence is part of a controlled differential; and
- broker audit outcomes.

The source hashes provide provenance if private source artifacts are reviewed later; they do not
make the public extracts independently equivalent to full raw transcripts. Conclusions that rely
on controlled differential evidence are labelled as such.

The original pre-public Git history, including the private source artifacts, was preserved in a
verified offline Git bundle before this minimization pass.
