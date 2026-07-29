import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { createFixture, PROTECTED_CANARY, type Fixture } from "../helpers/fixture.js";
import { connectInMemory, parseToolText } from "../helpers/mcp.js";

let fixture: Fixture | undefined;

afterEach(async () => {
  await fixture?.cleanup();
  fixture = undefined;
});

describe("attack: identity substitution", () => {
  it("ignores request identity and evaluates the immutable process subject", async () => {
    fixture = await createFixture();
    const broker = await fixture.createBroker("denied-agent");
    const connection = await connectInMemory(broker);
    try {
      const response = await connection.client.callTool({
        name: "read_resource",
        arguments: {
          resourceId: "protected",
          subjectId: "allowed-agent",
          identity: { subject: "allowed-agent" },
        },
      });
      const value = parseToolText(response);
      expect(value).toEqual({
        decision: "deny",
        reasonCode: "ACCESS_DENIED",
        resourceId: "protected",
      });
      expect(JSON.stringify(response)).not.toContain(PROTECTED_CANARY);
      const audit = await readFile(fixture.auditPath, "utf8");
      expect(audit).toContain('"subjectId":"denied-agent"');
      expect(audit).not.toContain('"subjectId":"allowed-agent"');
    } finally {
      await connection.close();
    }
  });
});
