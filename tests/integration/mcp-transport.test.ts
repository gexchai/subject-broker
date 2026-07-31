import { readFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, describe, expect, it } from "vitest";
import { createFixture, PROTECTED_CANARY, type Fixture } from "../helpers/fixture.js";
import { parseToolText } from "../helpers/mcp.js";

let fixture: Fixture | undefined;

afterEach(async () => {
  await fixture?.cleanup();
  fixture = undefined;
});

async function connect(subjectId: string, fixtureValue: Fixture, serverName?: string) {
  const optionalServerName =
    serverName === undefined ? [] : ["--server-name", serverName];
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      path.resolve("dist/server.js"),
      "--policy",
      fixtureValue.policyPath,
      "--subject",
      subjectId,
      "--audit",
      fixtureValue.auditPath,
      "--max-bytes",
      "1048576",
      ...optionalServerName,
    ],
    cwd: fixtureValue.projectDir,
    stderr: "pipe",
  });
  const client = new Client({ name: "subject-broker-integration", version: "1.0.0" });
  await client.connect(transport);
  return { client, transport };
}

describe("stdio MCP transport", () => {
  it("exposes exactly four tools and completes allow and deny flows end to end", async () => {
    fixture = await createFixture();

    const allowed = await connect("allowed-agent", fixture, "sbAllowed");
    try {
      expect(allowed.client.getServerVersion()?.name).toBe("sbAllowed");
      const tools = await allowed.client.listTools();
      expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
        "capability_report",
        "explain_decision",
        "list_resources",
        "read_resource",
      ]);
      const readTool = tools.tools.find((tool) => tool.name === "read_resource");
      expect(readTool?.description).toContain('bound to subject "allowed-agent"');
      expect(readTool?.description).toContain(
        "A denial must not be retried through another SubjectBroker connection.",
      );

      const capability = parseToolText(
        await allowed.client.callTool({ name: "capability_report", arguments: {} }),
      );
      expect(capability).toMatchObject({
        version: "0.1.0-spike",
        platform: "darwin",
        activeEnforcementLevel: "hard-enforcement",
        coveredOperation: "read_resource for registered resources through this MCP process",
        policyLoaded: true,
      });
      expect(capability.uncoveredPaths).toContain(
        "direct filesystem or shell access by an agent running as the same user",
      );

      const listed = parseToolText(
        await allowed.client.callTool({ name: "list_resources", arguments: {} }),
      );
      expect(listed).toEqual({ resources: ["protected"], reasonCode: "ALLOWED" });
      expect(JSON.stringify(listed)).not.toContain(PROTECTED_CANARY);

      const read = parseToolText(
        await allowed.client.callTool({
          name: "read_resource",
          arguments: { resourceId: "protected" },
        }),
      );
      expect(read).toEqual({
        decision: "allow",
        reasonCode: "ALLOWED",
        resourceId: "protected",
        content: PROTECTED_CANARY,
      });
    } finally {
      await allowed.client.close();
    }

    const denied = await connect("denied-agent", fixture);
    try {
      const read = await denied.client.callTool({
        name: "read_resource",
        arguments: { resourceId: "protected" },
      });
      expect(parseToolText(read)).toEqual({
        decision: "deny",
        reasonCode: "ACCESS_DENIED",
        resourceId: "protected",
      });
      expect(JSON.stringify(read)).not.toContain(PROTECTED_CANARY);

      const explanation = await denied.client.callTool({
        name: "explain_decision",
        arguments: { resourceId: "protected", action: "read" },
      });
      expect(parseToolText(explanation)).toEqual({
        decision: "deny",
        reasonCode: "ACCESS_DENIED",
        resourceId: "protected",
        action: "read",
      });
    } finally {
      await denied.client.close();
    }

    const audit = await readFile(fixture.auditPath, "utf8");
    expect(audit).toContain('"decision":"allow"');
    expect(audit).toContain('"decision":"deny"');
    expect(audit).not.toContain(PROTECTED_CANARY);
    expect(audit).not.toContain(fixture.protectedPath);
  });
});
