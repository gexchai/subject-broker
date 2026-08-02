import { execFile } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildMacOSSandboxProfile,
  resolveHostIsolationBoundary,
} from "../../src/isolated-opencode.js";
import { startSocketBroker, type SocketBrokerHandle } from "../../src/socket-broker.js";
import { createFixture, PROTECTED_CANARY, type Fixture } from "../helpers/fixture.js";

const execFileAsync = promisify(execFile);
let fixture: Fixture | undefined;
let brokerHandle: SocketBrokerHandle | undefined;
let workspace: string | undefined;

afterEach(async () => {
  await brokerHandle?.close();
  brokerHandle = undefined;
  await fixture?.cleanup();
  fixture = undefined;
  if (workspace !== undefined) {
    await rm(workspace, { recursive: true, force: true });
    workspace = undefined;
  }
});

describe("macOS host-isolation differential", () => {
  it.runIf(process.platform === "darwin")(
    "blocks direct reads while preserving the authorized broker path",
    async () => {
      fixture = await createFixture();
      workspace = await mkdtemp("/private/tmp/sb-workspace-");
      const socketPath = path.join(workspace, "agent.sock");
      const probePath = path.join(workspace, "probe.mjs");
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
      const boundary = await resolveHostIsolationBoundary({
        workspace,
        policyPath: fixture.policyPath,
        auditPath: fixture.auditPath,
      });
      const clientModule = fileURLToPath(
        new URL("../../node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js", import.meta.url),
      );
      const transportModule = fileURLToPath(
        new URL("../../node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js", import.meta.url),
      );
      const relayModule = fileURLToPath(
        new URL("../../dist/socket-relay.js", import.meta.url),
      );
      await writeFile(
        probePath,
        `import { readFile } from "node:fs/promises";
import { Client } from ${JSON.stringify(clientModule)};
import { StdioClientTransport } from ${JSON.stringify(transportModule)};
let directRead = "readable";
try { await readFile(${JSON.stringify(fixture.protectedPath)}, "utf8"); }
catch (error) { directRead = error.code; }
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [${JSON.stringify(relayModule)}, "--socket", ${JSON.stringify(socketPath)}],
  stderr: "pipe",
});
const client = new Client({ name: "host-isolation-probe", version: "1.0.0" });
await client.connect(transport);
const result = await client.callTool({ name: "read_resource", arguments: { resourceId: "protected" } });
await client.close();
process.stdout.write(JSON.stringify({ directRead, result }));
`,
        { mode: 0o700 },
      );
      await chmod(probePath, 0o700);

      const { stdout } = await execFileAsync(
        "/usr/bin/sandbox-exec",
        [
          "-p",
          buildMacOSSandboxProfile(boundary, undefined, workspace),
          process.execPath,
          probePath,
        ],
        { cwd: workspace, encoding: "utf8" },
      );
      const result = JSON.parse(stdout) as {
        directRead: string;
        result: { content?: Array<{ text?: string }> };
      };
      expect(result.directRead).toBe("EPERM");
      expect(JSON.stringify(result.result)).toContain(PROTECTED_CANARY);

      const audit = await readFile(fixture.auditPath, "utf8");
      expect(audit).toContain('"subjectId":"allowed-agent"');
      expect(audit).toContain('"decision":"allow"');
      expect(audit).not.toContain(PROTECTED_CANARY);
    },
  );
});
