import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { SubjectBroker } from "../../src/broker.js";
import { createMcpServer } from "../../src/mcp-server.js";

export async function connectInMemory(broker: SubjectBroker) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer(broker);
  const client = new Client({ name: "subject-broker-tests", version: "1.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

export function parseToolText(result: {
  content?: readonly { type: string; text?: string }[];
}): Record<string, unknown> {
  const item = result.content?.find((candidate) => candidate.type === "text");
  if (item?.text === undefined) {
    throw new Error("Tool result did not contain text");
  }
  return JSON.parse(item.text) as Record<string, unknown>;
}
