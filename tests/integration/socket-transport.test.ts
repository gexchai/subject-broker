import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, describe, expect, it } from "vitest";
import { startSocketBroker, type SocketBrokerHandle } from "../../src/socket-broker.js";
import { UnixSocketClientTransport } from "../../src/unix-socket-transport.js";
import { createFixture, PROTECTED_CANARY, type Fixture } from "../helpers/fixture.js";
import { parseToolText } from "../helpers/mcp.js";

let fixture: Fixture | undefined;
let brokerHandle: SocketBrokerHandle | undefined;

afterEach(async () => {
  await brokerHandle?.close();
  brokerHandle = undefined;
  await fixture?.cleanup();
  fixture = undefined;
});

describe("Unix-socket MCP transport", () => {
  it("keeps subject configuration in the broker process while serving MCP", async () => {
    fixture = await createFixture();
    const socketPath = path.join(fixture.root, "allowed-agent.sock");
    brokerHandle = await startSocketBroker(
      {
        policyPath: fixture.policyPath,
        subjectId: "allowed-agent",
        auditPath: fixture.auditPath,
        failOnStartupError: true,
      },
      "sbAllowed",
      socketPath,
    );

    const transport = new UnixSocketClientTransport(socketPath);
    const client = new Client({ name: "socket-integration", version: "1.0.0" });
    await client.connect(transport);
    try {
      expect(client.getServerVersion()?.name).toBe("sbAllowed");
      const result = parseToolText(
        await client.callTool({
          name: "read_resource",
          arguments: { resourceId: "protected" },
        }),
      );
      expect(result).toEqual({
        decision: "allow",
        reasonCode: "ALLOWED",
        resourceId: "protected",
        content: PROTECTED_CANARY,
      });
    } finally {
      await client.close();
    }
  });

  it("carries stdio MCP through the constrained relay", async () => {
    fixture = await createFixture();
    const socketPath = path.join(fixture.root, "relay-agent.sock");
    brokerHandle = await startSocketBroker(
      {
        policyPath: fixture.policyPath,
        subjectId: "denied-agent",
        auditPath: fixture.auditPath,
        failOnStartupError: true,
      },
      "sbDenied",
      socketPath,
    );
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.resolve("dist/socket-relay.js"), "--socket", socketPath],
      stderr: "pipe",
    });
    const client = new Client({ name: "relay-integration", version: "1.0.0" });
    await client.connect(transport);
    try {
      const result = parseToolText(
        await client.callTool({
          name: "read_resource",
          arguments: { resourceId: "protected" },
        }),
      );
      expect(result).toEqual({
        decision: "deny",
        reasonCode: "ACCESS_DENIED",
        resourceId: "protected",
      });
      expect(JSON.stringify(result)).not.toContain(PROTECTED_CANARY);
    } finally {
      await client.close();
    }
  });
});
