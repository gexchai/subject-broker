import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  createCapabilityReport,
  SUBJECT_BROKER_VERSION,
} from "../../src/capability.js";

describe("capability report", () => {
  it("scopes hard enforcement to the macOS broker read and names uncovered paths", () => {
    const report = createCapabilityReport("darwin", true);
    expect(report).toMatchInlineSnapshot(`
      {
        "activeEnforcementLevel": "hard-enforcement",
        "assumptions": [
          "the macOS host and SubjectBroker process are not compromised",
          "the project owner controls policy, startup configuration, storage, and audit destination",
          "registered storage is outside the agent working tree and has mode 0700",
          "hard-enforcement applies only to the brokered read_resource operation",
          "the calling agent context cannot access a more privileged subject-bound SubjectBroker connection",
        ],
        "coveredOperation": "read_resource for registered resources through this MCP process",
        "platform": "darwin",
        "policyLoaded": true,
        "subjectBinding": "immutable process-level subject configured at server startup",
        "uncoveredPaths": [
          "direct filesystem or shell access by an agent running as the same user",
          "same-user processes can choose different subjects, policies, and audit destinations at startup",
          "co-located subject-bound connections combine their permissions in the calling agent context",
          "network, browser, clipboard, process, environment, credential, and non-MCP tool access",
          "copies already present in prompts, logs, caches, indexes, or prior allowed responses",
          "provider retention or downstream use after content is released",
        ],
        "version": "0.1.0",
      }
    `);
  });

  it("does not claim support on another platform", () => {
    expect(createCapabilityReport("linux", true).activeEnforcementLevel).toBe("unsupported");
  });

  it("does not claim active enforcement when policy is unavailable", () => {
    expect(createCapabilityReport("darwin", false).activeEnforcementLevel).toBe("unsupported");
  });

  it("keeps the reported server version aligned with package metadata", async () => {
    const packageMetadata = JSON.parse(await readFile("package.json", "utf8")) as {
      version?: string;
    };
    expect(SUBJECT_BROKER_VERSION).toBe(packageMetadata.version);
  });
});
