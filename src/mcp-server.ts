import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SubjectBroker } from "./broker.js";
import { SPIKE_VERSION } from "./capability.js";

export const DEFAULT_MCP_SERVER_NAME = "subject-broker";

function textResult<T extends object>(value: T, isError = false) {
  const structuredContent = value as Record<string, unknown>;
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    structuredContent,
    isError,
  };
}

const ignoredIdentityFields = z.looseObject({});
const resourceInput = z.looseObject({
  resourceId: z.string(),
});
const explainInput = z.looseObject({
  resourceId: z.string(),
  action: z.string().default("read"),
});

export function createMcpServer(
  broker: SubjectBroker,
  serverName = DEFAULT_MCP_SERVER_NAME,
): McpServer {
  const subjectBoundary =
    `This connection is bound to subject "${broker.subjectId}". ` +
    "A denial must not be retried through another SubjectBroker connection.";
  const server = new McpServer({
    name: serverName,
    version: SPIKE_VERSION,
  });

  server.registerTool(
    "list_resources",
    {
      description:
        `List registered resource ids readable by the process-bound subject; never content. ${subjectBoundary}`,
      inputSchema: ignoredIdentityFields,
    },
    async () => textResult(broker.listResources()),
  );

  server.registerTool(
    "read_resource",
    {
      description:
        `Read one registered resource after policy evaluation and audit. ${subjectBoundary}`,
      inputSchema: resourceInput,
    },
    async ({ resourceId }) => {
      const result = await broker.readResource(resourceId);
      return textResult(result, result.decision !== "allow");
    },
  );

  server.registerTool(
    "explain_decision",
    {
      description:
        `Return a non-sensitive reason code for the bound subject, resource, and action. ${subjectBoundary}`,
      inputSchema: explainInput,
    },
    async ({ resourceId, action }) => {
      const result = broker.explain(resourceId, action);
      return textResult(result, result.decision !== "allow");
    },
  );

  server.registerTool(
    "capability_report",
    {
      description:
        `Report active enforcement scope, assumptions, limitations, platform, and version. ${subjectBoundary}`,
      inputSchema: ignoredIdentityFields,
    },
    async () => textResult(broker.capabilityReport()),
  );

  return server;
}
