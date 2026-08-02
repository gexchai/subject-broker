import { chmod, link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildMacOSSandboxProfile,
  IsolatedOpenCodeError,
  resolveHostIsolationBoundary,
  runIsolatedOpenCodeSubject,
} from "../../src/isolated-opencode.js";
import { createFixture, type Fixture } from "../helpers/fixture.js";

let fixture: Fixture | undefined;
const workspaceRoots: string[] = [];

afterEach(async () => {
  await fixture?.cleanup();
  fixture = undefined;
  await Promise.all(
    workspaceRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("isolated OpenCode reference launcher", () => {
  it("builds a deny profile for storage, policy, and audit paths", async () => {
    fixture = await createFixture();
    const workspace = await mkdtemp("/private/tmp/sb-workspace-");
    workspaceRoots.push(workspace);
    const boundary = await resolveHostIsolationBoundary({
      workspace,
      policyPath: fixture.policyPath,
      auditPath: fixture.auditPath,
    });
    const profile = buildMacOSSandboxProfile(
      boundary,
      "/private/tmp/agent.sb",
      "/private/tmp/capability",
    );

    expect(boundary.trustRoot).toBe(fixture.root);
    expect(profile).toContain(`(deny file-read* (subpath "${fixture.root}"))`);
    expect(profile).toContain(`(deny file-write* (subpath "${fixture.root}"))`);
    expect(profile).toContain(
      '(deny file-write* (subpath "/private/tmp/capability"))',
    );
  });

  it("rejects a workspace that contains protected storage", async () => {
    fixture = await createFixture();
    await expect(
      resolveHostIsolationBoundary({
        workspace: fixture.root,
        policyPath: fixture.policyPath,
        auditPath: fixture.auditPath,
      }),
    ).rejects.toBeInstanceOf(IsolatedOpenCodeError);
  });

  it.runIf(process.platform === "darwin")(
    "keeps direct and symlink-aliased reads blocked in the launched process",
    async () => {
      fixture = await createFixture();
      const workspace = await mkdtemp("/private/tmp/sb-workspace-");
      workspaceRoots.push(workspace);
      const resultPath = path.join(workspace, "sandbox-result.json");
      const aliasPath = path.join(workspace, "protected-alias.txt");
      const hardLinkPath = path.join(workspace, "protected-hard-link.txt");
      const fakeOpenCode = path.join(workspace, "fake-opencode.mjs");
      await symlink(fixture.protectedPath, aliasPath);
      await writeFile(
        fakeOpenCode,
        `#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
if (process.argv.includes("debug")) {
  process.stdout.write(process.env.OPENCODE_CONFIG_CONTENT ?? "{}");
} else {
  const outcomes = ${JSON.stringify([
    fixture.protectedPath,
    aliasPath,
    fixture.policyPath,
  ])}.map((candidate) => {
    try { readFileSync(candidate); return "readable"; }
    catch (error) { return error.code; }
  });
  const inlineConfig = process.env.OPENCODE_CONFIG_CONTENT ?? "";
  outcomes.push(
    ${JSON.stringify([fixture.protectedPath, fixture.policyPath, fixture.auditPath])}.some(
      (candidate) => inlineConfig.includes(candidate),
    ) ? "trusted-path-leaked" : "trusted-path-clean",
  );
  outcomes.push(
    Object.keys(process.env).some((key) => key.startsWith("SUBJECT_BROKER_"))
      ? "broker-env-leaked"
      : "broker-env-clean",
  );
  try {
    const { link } = await import("node:fs/promises");
    await link(${JSON.stringify(fixture.protectedPath)}, ${JSON.stringify(hardLinkPath)});
    outcomes.push("hard-link-created");
  } catch (error) {
    outcomes.push(error.code);
  }
  writeFileSync(${JSON.stringify(resultPath)}, JSON.stringify(outcomes));
}
`,
        { mode: 0o700 },
      );
      await chmod(fakeOpenCode, 0o700);

      const previousBrokerPolicy = process.env.SUBJECT_BROKER_POLICY;
      process.env.SUBJECT_BROKER_POLICY = fixture.policyPath;
      try {
        await expect(
          runIsolatedOpenCodeSubject({
            subjectId: "allowed-agent",
            policyPath: fixture.policyPath,
            auditPath: fixture.auditPath,
            workspace,
            opencodeExecutable: fakeOpenCode,
            serverName: "sbAllowed",
            opencodeArguments: [],
          }),
        ).resolves.toBe(0);
      } finally {
        if (previousBrokerPolicy === undefined) {
          delete process.env.SUBJECT_BROKER_POLICY;
        } else {
          process.env.SUBJECT_BROKER_POLICY = previousBrokerPolicy;
        }
      }

      const outcomes = JSON.parse(await readFile(resultPath, "utf8")) as string[];
      expect(outcomes).toEqual([
        "EPERM",
        "EPERM",
        "EPERM",
        "trusted-path-clean",
        "broker-env-clean",
        "EPERM",
      ]);
    },
  );

  it("rejects a registered resource with a pre-existing hard link", async () => {
    fixture = await createFixture();
    const workspace = await mkdtemp("/private/tmp/sb-workspace-");
    workspaceRoots.push(workspace);
    await link(fixture.protectedPath, path.join(workspace, "protected-hard-link.txt"));

    await expect(
      resolveHostIsolationBoundary({
        workspace,
        policyPath: fixture.policyPath,
        auditPath: fixture.auditPath,
      }),
    ).rejects.toMatchObject({ code: "HOST_BOUNDARY_INVALID" });
  });
});
