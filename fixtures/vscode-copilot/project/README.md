# SubjectBroker VS Code field-test workspace

This is a synthetic test workspace. It intentionally contains no protected bytes.

Use `SB Parent` for C1, C3, and C4. Use `SB Unrestricted Parent` only for the C2 ordinary-child
control. Do not enable built-in file, search, terminal, web, or extension tools for these cases.
The generated policy and audit state lives in `.runtime/` and is ignored by Git.

Follow the prompts and evidence procedure in:

`../../../docs/field-test-vscode-copilot-subagent-isolation.md`
