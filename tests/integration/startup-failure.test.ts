import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFixture, PROTECTED_CANARY, type Fixture } from "../helpers/fixture.js";

const execFileAsync = promisify(execFile);
let fixture: Fixture | undefined;

afterEach(async () => {
  await fixture?.cleanup();
  fixture = undefined;
});

describe("MCP server startup failure", () => {
  it("exits non-zero with a non-sensitive diagnostic category", async () => {
    fixture = await createFixture();
    await writeFile(fixture.policyPath, `version: [\nsecret: ${PROTECTED_CANARY}`, "utf8");

    await expect(
      execFileAsync(process.execPath, [
        path.resolve("dist/server.js"),
        "--policy",
        fixture.policyPath,
        "--subject",
        "allowed-agent",
        "--audit",
        fixture.auditPath,
      ]),
    ).rejects.toMatchObject({
      code: 1,
      stdout: "",
      stderr: "SubjectBroker failed to start: POLICY_PARSE_ERROR\n",
    });
  });

  it("does not consume a neighboring flag as a missing value", async () => {
    await expect(
      execFileAsync(process.execPath, [
        path.resolve("dist/server.js"),
        "--policy",
        "--subject",
        "allowed-agent",
        "--audit",
        "/audit",
      ]),
    ).rejects.toMatchObject({
      code: 1,
      stdout: "",
      stderr: "SubjectBroker failed to start: MISSING_ARGUMENT_VALUE\n",
    });
  });
});
