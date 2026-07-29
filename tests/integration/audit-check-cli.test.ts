import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { createFixture, type Fixture } from "../helpers/fixture.js";

const execFileAsync = promisify(execFile);
let fixture: Fixture | undefined;

afterEach(async () => {
  await fixture?.cleanup();
  fixture = undefined;
});

describe("audit-check CLI", () => {
  it("returns structured findings and exit code 2 for a suspicious sequence", async () => {
    fixture = await createFixture();
    await writeFile(
      fixture.auditPath,
      [
        '{"timestamp":"2026-07-28T08:06:17.818Z","subjectId":"worker","resourceId":"secret","action":"read","decision":"deny","reasonCode":"ACCESS_DENIED"}',
        '{"timestamp":"2026-07-28T08:06:20.158Z","subjectId":"orchestrator","resourceId":"secret","action":"read","decision":"allow","reasonCode":"ALLOWED"}',
        "",
      ].join("\n"),
      { mode: 0o600 },
    );

    try {
      await execFileAsync(process.execPath, [
        path.resolve("dist/audit-check.js"),
        "--window-seconds",
        "10",
        fixture.auditPath,
      ]);
      throw new Error("Expected suspicious audit check to use exit code 2");
    } catch (error) {
      const result = error as {
        readonly code: number;
        readonly stdout: string;
        readonly stderr: string;
      };
      expect(result.code).toBe(2);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout)).toMatchObject({
        status: "suspicious",
        findingCount: 1,
        findings: [
          {
            kind: "CROSS_SUBJECT_DENY_THEN_ALLOW",
            resourceId: "secret",
            denied: { subjectId: "worker" },
            allowed: { subjectId: "orchestrator" },
          },
        ],
      });
    }
  });

  it("returns clear with exit code 0 when no heuristic match exists", async () => {
    fixture = await createFixture();
    await writeFile(
      fixture.auditPath,
      '{"timestamp":"2026-07-28T08:06:20.158Z","subjectId":"orchestrator","resourceId":"secret","action":"read","decision":"allow","reasonCode":"ALLOWED"}\n',
      { mode: 0o600 },
    );

    const result = await execFileAsync(process.execPath, [
      path.resolve("dist/audit-check.js"),
      fixture.auditPath,
    ]);

    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: "clear",
      findingCount: 0,
    });
  });
});
