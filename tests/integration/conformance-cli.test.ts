import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  runFinanceSupportConformance,
  type ConformanceReport,
} from "../../src/conformance.js";

const execFileAsync = promisify(execFile);

describe("finance/support conformance command", () => {
  it("produces a machine-readable proof of the broker boundary", async () => {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [path.resolve("dist/conformance.js")],
      { cwd: process.cwd() },
    );
    const report = JSON.parse(stdout) as ConformanceReport;

    expect(stderr).toBe("");
    expect(report).toMatchObject({
      schemaVersion: 1,
      subjectBrokerVersion: "0.2.0",
      fixture: "finance-support",
      platform: "darwin",
      status: "pass",
    });
    expect(
      report.checks
        .filter((check) => check.layer === "subject-broker")
        .every((check) => check.status === "pass"),
    ).toBe(true);
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "broker.direct_hidden_resource_call_denied",
          status: "pass",
        }),
        expect.objectContaining({
          id: "broker.request_identity_spoofing_denied",
          status: "pass",
        }),
        expect.objectContaining({
          id: "harness.cross_subject_connection_isolation",
          status: "not-provided",
        }),
        expect.objectContaining({
          id: "host.direct_resource_isolation",
          status: "not-provided",
        }),
      ]),
    );
    expect(stdout).not.toContain("FINANCE_CONFORMANCE_CANARY");
    expect(stdout).not.toContain("SUPPORT_CONFORMANCE_CANARY");
    expect(stdout).not.toContain("protected-storage");
  });

  it("reports unsupported instead of claiming enforcement on another platform", async () => {
    await expect(runFinanceSupportConformance("linux")).resolves.toMatchObject({
      status: "unsupported",
      checks: expect.arrayContaining([
        expect.objectContaining({
          id: "broker.registered_resource_enforcement",
          status: "unsupported",
        }),
      ]),
    });
  });
});
