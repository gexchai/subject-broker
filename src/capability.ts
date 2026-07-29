import type { CapabilityReport } from "./model.js";

export const SPIKE_VERSION = "0.1.0-spike";

export function createCapabilityReport(
  platform: NodeJS.Platform,
  policyLoaded: boolean,
): CapabilityReport {
  const supported = platform === "darwin" && policyLoaded;
  return {
    version: SPIKE_VERSION,
    platform,
    activeEnforcementLevel: supported ? "hard-enforcement" : "unsupported",
    coveredOperation: "read_resource for registered resources through this MCP process",
    subjectBinding: "immutable process-level subject configured at server startup",
    policyLoaded,
    assumptions: [
      "the macOS host and SubjectBroker process are not compromised",
      "the project owner controls policy, startup configuration, storage, and audit destination",
      "registered storage is outside the agent working tree and has mode 0700",
      "hard-enforcement applies only to the brokered read_resource operation",
      "the calling agent context cannot access a more privileged subject-bound SubjectBroker connection",
    ],
    uncoveredPaths: [
      "direct filesystem or shell access by an agent running as the same user",
      "same-user processes can choose different subjects, policies, and audit destinations at startup",
      "co-located subject-bound connections combine their permissions in the calling agent context",
      "network, browser, clipboard, process, environment, credential, and non-MCP tool access",
      "copies already present in prompts, logs, caches, indexes, or prior allowed responses",
      "provider retention or downstream use after content is released",
    ],
  };
}
