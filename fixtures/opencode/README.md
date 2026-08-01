# OpenCode field-test fixture

This fixture reproduces the OpenCode 1.18.10 named-subagent MCP isolation test with synthetic
content. It uses fixture-local OpenCode state and separate broker audit files. It does not read
or modify the user's normal OpenCode credentials.

The fixture requires a built SubjectBroker checkout and an OpenCode executable. From the
repository root:

```bash
fixtures/opencode/scripts/prepare-fixture.sh
fixtures/opencode/scripts/prepare-case.sh c1-parent-control
OPENCODE_BIN=/absolute/path/to/opencode \
  fixtures/opencode/scripts/run-case.sh \
  c1-parent-control opencode/deepseek-v4-flash-free
fixtures/opencode/scripts/capture-case.sh c1-parent-control
```

Run C1 through C7 independently. C6 intentionally records the default depth-1 rejection. C7
sets `subagent_depth` to 2 through `OPENCODE_CONFIG_CONTENT` for that process only.

Do not accept an empty orchestrator audit as a pass unless the corresponding worker positive
control succeeded. Retain child exports when independently reproducing the result.
