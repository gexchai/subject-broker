import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildOpenCodeSubjectProfile,
  OpenCodeAdapterError,
  parseOpenCodeAdapterArguments,
  resolvedProfileIsIsolated,
  runOpenCodeSubject,
} from "../../src/opencode-adapter.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("OpenCode single-subject adapter", () => {
  it("builds one fail-closed subject-bound MCP profile", () => {
    const profile = buildOpenCodeSubjectProfile(
      {
        subjectId: "finance-agent",
        policyPath: "/fixture/policy.yaml",
        auditPath: "/fixture/audit.jsonl",
        serverName: "sbFinanceAgent",
      },
      "/fixture/server.js",
    );

    expect(profile).toMatchObject({
      share: "disabled",
      default_agent: "subject-session",
      permission: {
        "*": "deny",
        sbFinanceAgent_read_resource: "allow",
      },
      mcp: {
        sbFinanceAgent: {
          type: "local",
          command: expect.arrayContaining([
            "/fixture/server.js",
            "--subject",
            "finance-agent",
          ]),
          enabled: true,
        },
      },
    });
    expect(Object.keys(profile.mcp)).toEqual(["sbFinanceAgent"]);
  });

  it("rejects resolved profiles containing another MCP connection", () => {
    const profile = buildOpenCodeSubjectProfile(
      {
        subjectId: "support-agent",
        policyPath: "/fixture/policy.yaml",
        auditPath: "/fixture/audit.jsonl",
        serverName: "sbSupportAgent",
      },
      "/fixture/server.js",
    );

    expect(resolvedProfileIsIsolated(profile, profile)).toBe(true);
    expect(
      resolvedProfileIsIsolated(
        { ...profile, mcp: { ...profile.mcp, unexpected: { type: "remote" } } },
        profile,
      ),
    ).toBe(false);
  });

  it("parses a closed adapter argument set and preserves OpenCode arguments", () => {
    expect(
      parseOpenCodeAdapterArguments(
        [
          "--subject",
          "finance-agent",
          "--policy",
          "policy.yaml",
          "--audit",
          "audit.jsonl",
          "--workspace",
          "workspace",
          "--",
          "run",
          "--model",
          "opencode/example",
          "hello",
        ],
        "/fixture",
      ),
    ).toMatchObject({
      subjectId: "finance-agent",
      policyPath: "/fixture/policy.yaml",
      auditPath: "/fixture/audit.jsonl",
      workspace: "/fixture/workspace",
      serverName: "sbFinanceAgent",
      opencodeArguments: ["run", "--model", "opencode/example", "hello"],
    });

    expect(() =>
      parseOpenCodeAdapterArguments(["--subject", "finance-agent", "--unknown", "x"]),
    ).toThrowError(OpenCodeAdapterError);
  });

  it("preflights the resolved MCP union before launching OpenCode", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "subject-broker-adapter-test-"));
    temporaryRoots.push(root);
    const workspace = path.join(root, "workspace");
    const fakeOpenCode = path.join(root, "fake-opencode.mjs");
    await mkdir(workspace);
    await writeFile(
      fakeOpenCode,
      `#!/usr/bin/env node
if (process.argv.includes("debug")) {
  process.stdout.write(process.env.OPENCODE_CONFIG_CONTENT ?? "{}");
}
`,
      { mode: 0o700 },
    );
    await chmod(fakeOpenCode, 0o700);

    await expect(
      runOpenCodeSubject({
        subjectId: "finance-agent",
        policyPath: path.join(root, "policy.yaml"),
        auditPath: path.join(root, "audit.jsonl"),
        workspace,
        opencodeExecutable: fakeOpenCode,
        serverName: "sbFinanceAgent",
        opencodeArguments: ["run", "synthetic prompt"],
      }),
    ).resolves.toBe(0);
  });

  it("fails closed when OpenCode resolves an additional MCP connection", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "subject-broker-adapter-test-"));
    temporaryRoots.push(root);
    const workspace = path.join(root, "workspace");
    const fakeOpenCode = path.join(root, "fake-opencode.mjs");
    await mkdir(workspace);
    await writeFile(
      fakeOpenCode,
      `#!/usr/bin/env node
const config = JSON.parse(process.env.OPENCODE_CONFIG_CONTENT ?? "{}");
config.mcp.unexpected = { type: "remote", url: "https://invalid.example" };
process.stdout.write(JSON.stringify(config));
`,
      { mode: 0o700 },
    );
    await chmod(fakeOpenCode, 0o700);

    await expect(
      runOpenCodeSubject({
        subjectId: "finance-agent",
        policyPath: path.join(root, "policy.yaml"),
        auditPath: path.join(root, "audit.jsonl"),
        workspace,
        opencodeExecutable: fakeOpenCode,
        serverName: "sbFinanceAgent",
        opencodeArguments: [],
      }),
    ).rejects.toMatchObject({ code: "OPENCODE_PROFILE_NOT_ISOLATED" });
  });
});
