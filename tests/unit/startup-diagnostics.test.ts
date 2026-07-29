import { chmod, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stringify } from "yaml";
import {
  SubjectBroker,
  StartupConfigurationError,
  type StartupDiagnosticCode,
} from "../../src/broker.js";
import {
  parseServerArguments,
  StartupArgumentError,
  type StartupArgumentErrorCode,
  startupErrorMessage,
} from "../../src/server.js";
import {
  createFixture,
  PROTECTED_CANARY,
  type Fixture,
  type FixturePolicy,
} from "../helpers/fixture.js";

let fixture: Fixture | undefined;

afterEach(async () => {
  await fixture?.cleanup();
  fixture = undefined;
});

async function expectStartupFailure(
  code: StartupDiagnosticCode,
  policyPath: string,
): Promise<void> {
  try {
    await SubjectBroker.create({
      policyPath,
      subjectId: "allowed-agent",
      auditPath: fixture!.auditPath,
      workingDirectory: fixture!.projectDir,
      platform: "darwin",
      failOnStartupError: true,
    });
    throw new Error("Expected startup to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(StartupConfigurationError);
    expect((error as StartupConfigurationError).code).toBe(code);
    expect(startupErrorMessage(error)).toBe(`SubjectBroker failed to start: ${code}\n`);
    expect(startupErrorMessage(error)).not.toContain(fixture!.root);
    expect(startupErrorMessage(error)).not.toContain(PROTECTED_CANARY);
  }
}

function expectArgumentFailure(
  code: StartupArgumentErrorCode,
  args: readonly string[],
): void {
  try {
    parseServerArguments(args, {});
    throw new Error("Expected argument parsing to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(StartupArgumentError);
    expect((error as StartupArgumentError).code).toBe(code);
    expect(startupErrorMessage(error)).toBe(`SubjectBroker failed to start: ${code}\n`);
  }
}

describe("server startup diagnostics", () => {
  it("parses and validates the resource byte limit", () => {
    expect(
      parseServerArguments(
        ["--policy", "/policy", "--subject", "agent", "--audit", "/audit"],
        {},
      ).maxResourceBytes,
    ).toBe(1024 * 1024);
    expect(
      parseServerArguments(
        [
          "--policy",
          "/policy",
          "--subject",
          "agent",
          "--audit",
          "/audit",
          "--max-bytes",
          "2048",
        ],
        {},
      ).maxResourceBytes,
    ).toBe(2048);
    expectArgumentFailure("INVALID_MAX_RESOURCE_BYTES", [
      "--policy",
      "/policy",
      "--subject",
      "agent",
      "--audit",
      "/audit",
      "--max-bytes",
      "unbounded",
    ]);
  });

  it("rejects missing, duplicate, and unknown arguments without consuming flags as values", () => {
    expectArgumentFailure("MISSING_REQUIRED_ARGUMENT", [
      "--policy",
      "/policy",
      "--subject",
      "agent",
    ]);
    expectArgumentFailure("MISSING_ARGUMENT_VALUE", [
      "--policy",
      "--subject",
      "agent",
      "--audit",
      "/audit",
    ]);
    expectArgumentFailure("DUPLICATE_ARGUMENT", [
      "--policy",
      "/first",
      "--policy",
      "/second",
      "--subject",
      "agent",
      "--audit",
      "/audit",
    ]);
    expectArgumentFailure("UNKNOWN_ARGUMENT", [
      "--policy",
      "/policy",
      "--subject",
      "agent",
      "--audit",
      "/audit",
      "--unexpected",
      "value",
    ]);
  });

  it("categorizes missing and invalid policy", async () => {
    fixture = await createFixture();
    await expectStartupFailure(
      "POLICY_FILE_UNAVAILABLE",
      path.join(fixture.projectDir, "missing.yaml"),
    );

    await writeFile(fixture.policyPath, `version: [\nsecret: ${PROTECTED_CANARY}`, "utf8");
    await expectStartupFailure("POLICY_PARSE_ERROR", fixture.policyPath);
  });

  it("categorizes invalid storage mode", async () => {
    fixture = await createFixture();
    await chmod(fixture.storageRoot, 0o755);
    await expectStartupFailure("STORAGE_MODE_INVALID", fixture.policyPath);
  });

  it("categorizes symlinked and missing resources", async () => {
    fixture = await createFixture();
    const linkedPath = path.join(fixture.storageRoot, "linked.txt");
    await symlink(fixture.protectedPath, linkedPath);

    const basePolicy: FixturePolicy = {
      version: 1,
      storageRoot: fixture.storageRoot,
      subjects: ["allowed-agent"],
      resources: { protected: { path: linkedPath } },
      rules: [
        {
          subject: "allowed-agent",
          resource: "protected",
          action: "read",
          decision: "allow",
        },
      ],
    };
    await writeFile(fixture.policyPath, stringify(basePolicy), "utf8");
    await expectStartupFailure("PATH_CONTAINS_SYMLINK", fixture.policyPath);

    const missingPolicy: FixturePolicy = {
      ...basePolicy,
      resources: {
        protected: { path: path.join(fixture.storageRoot, "missing.txt") },
      },
    };
    await writeFile(fixture.policyPath, stringify(missingPolicy), "utf8");
    await expectStartupFailure("RESOURCE_MISSING", fixture.policyPath);
  });
});
