import {
  chmod,
  mkdir,
  readFile,
  rename,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  SubjectBroker,
  StartupConfigurationError,
} from "../../src/broker.js";
import { createFixture, type Fixture } from "../helpers/fixture.js";

let fixture: Fixture | undefined;

afterEach(async () => {
  await fixture?.cleanup();
  fixture = undefined;
});

async function createStrictBroker(
  auditPath: string,
  onDiagnostic?: (code: "AUDIT_DESTINATION_INVALID" | "AUDIT_WRITE_FAILED") => void,
): Promise<SubjectBroker> {
  return SubjectBroker.create({
    policyPath: fixture!.policyPath,
    subjectId: "allowed-agent",
    auditPath,
    workingDirectory: fixture!.projectDir,
    platform: "darwin",
    failOnStartupError: true,
    onDiagnostic,
  });
}

describe("audit destination validation", () => {
  it("creates a missing audit file with mode 0600", async () => {
    fixture = await createFixture();
    await createStrictBroker(fixture.auditPath);

    expect((await stat(fixture.auditPath)).mode & 0o777).toBe(0o600);
  });

  it("sets mode 0600 explicitly even when the process umask removes owner write", async () => {
    fixture = await createFixture();
    const previousUmask = process.umask(0o200);
    try {
      await createStrictBroker(fixture.auditPath);
    } finally {
      process.umask(previousUmask);
    }

    expect((await stat(fixture.auditPath)).mode & 0o777).toBe(0o600);
  });

  it("accepts a regular 0600 file and appends an event", async () => {
    fixture = await createFixture();
    await writeFile(fixture.auditPath, "", { mode: 0o600 });
    await chmod(fixture.auditPath, 0o600);
    const broker = await createStrictBroker(fixture.auditPath);

    await expect(broker.readResource("protected")).resolves.toMatchObject({
      decision: "allow",
    });
    expect(await readFile(fixture.auditPath, "utf8")).toContain('"decision":"allow"');
  });

  it("blocks release if permissions become unsafe after startup", async () => {
    fixture = await createFixture();
    const diagnostics: string[] = [];
    const broker = await createStrictBroker(fixture.auditPath, (code) => {
      diagnostics.push(code);
    });
    await chmod(fixture.auditPath, 0o644);

    await expect(broker.readResource("protected")).resolves.toEqual({
      decision: "error",
      reasonCode: "AUDIT_FAILED",
      resourceId: "protected",
    });
    expect(diagnostics).toEqual(["AUDIT_DESTINATION_INVALID"]);
  });

  it("rejects a pre-existing file with group or other permissions", async () => {
    fixture = await createFixture();
    await writeFile(fixture.auditPath, "", { mode: 0o644 });
    await chmod(fixture.auditPath, 0o644);

    await expect(createStrictBroker(fixture.auditPath)).rejects.toMatchObject({
      name: StartupConfigurationError.name,
      code: "AUDIT_DESTINATION_INVALID",
    });
  });

  it("rejects a symlink audit destination", async () => {
    fixture = await createFixture();
    const target = path.join(fixture.root, "audit-target.jsonl");
    await writeFile(target, "", { mode: 0o600 });
    await symlink(target, fixture.auditPath);

    await expect(createStrictBroker(fixture.auditPath)).rejects.toMatchObject({
      name: StartupConfigurationError.name,
      code: "AUDIT_DESTINATION_INVALID",
    });
  });

  it.runIf(process.platform === "darwin")(
    "blocks release when an audit ancestor is replaced by a symlink",
    async () => {
      fixture = await createFixture();
      const auditDirectory = path.join(fixture.root, "audit-directory");
      const movedDirectory = `${auditDirectory}-moved`;
      const auditPath = path.join(auditDirectory, "events.jsonl");
      await mkdir(auditDirectory, { mode: 0o700 });
      const diagnostics: string[] = [];
      const broker = await createStrictBroker(auditPath, (code) => {
        diagnostics.push(code);
      });
      await rename(auditDirectory, movedDirectory);
      await symlink(movedDirectory, auditDirectory, "dir");

      await expect(broker.readResource("protected")).resolves.toEqual({
        decision: "error",
        reasonCode: "AUDIT_FAILED",
        resourceId: "protected",
      });
      expect(diagnostics).toEqual(["AUDIT_DESTINATION_INVALID"]);
    },
  );
});
