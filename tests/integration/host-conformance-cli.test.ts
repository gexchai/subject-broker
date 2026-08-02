import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  runHostConformance,
  type HostConformanceReport,
} from "../../src/host-conformance.js";

const execFileAsync = promisify(execFile);

describe("host conformance command", () => {
  it.runIf(process.platform === "darwin")(
    "proves the macOS direct-read differential without exposing canaries",
    async () => {
      const { stdout, stderr } = await execFileAsync(
        process.execPath,
        [path.resolve("dist/host-conformance.js")],
        { cwd: process.cwd() },
      );
      const report = JSON.parse(stdout) as HostConformanceReport;

      expect(stderr).toBe("");
      expect(report).toMatchObject({
        schemaVersion: 1,
        subjectBrokerVersion: "0.2.0",
        fixture: "macos-isolated-finance",
        platform: "darwin",
        hostMechanism: "sandbox-exec",
        status: "pass",
        enforcementLevels: {
          subjectBroker: "enforced",
          agentHarness: "not-exercised",
          hostResource: "enforced",
          subjectIdentity: "not-provided",
        },
      });
      expect(report.checks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "host.direct_resource_read_blocked",
            status: "pass",
          }),
          expect.objectContaining({
            id: "host.symlink_alias_read_blocked",
            status: "pass",
          }),
          expect.objectContaining({
            id: "broker.authorized_socket_read",
            status: "pass",
          }),
          expect.objectContaining({
            id: "host.broker_outside_sandbox_differential",
            status: "pass",
          }),
          expect.objectContaining({
            id: "host.non_transferable_subject_identity",
            status: "not-provided",
          }),
        ]),
      );
      expect(report.checks.some((check) => check.status === "fail")).toBe(false);
      expect(stdout).not.toContain("HOST_FINANCE_CANARY");
      expect(stdout).not.toContain("HOST_SUPPORT_CANARY");
    },
  );

  it("reports unsupported on a non-macOS platform", async () => {
    await expect(runHostConformance("linux")).resolves.toMatchObject({
      status: "unsupported",
      checks: [expect.objectContaining({ status: "unsupported" })],
    });
  });
});
