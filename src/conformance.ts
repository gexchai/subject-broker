#!/usr/bin/env node
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { stringify } from "yaml";
import { z } from "zod";
import { SubjectBroker } from "./broker.js";
import { SUBJECT_BROKER_VERSION } from "./capability.js";
import { createMcpServer } from "./mcp-server.js";
import { REASON_CODES } from "./model.js";

const FINANCE_CANARY = "FINANCE_CONFORMANCE_CANARY_6e21b8";
const SUPPORT_CANARY = "SUPPORT_CONFORMANCE_CANARY_83d4ac";

export type ConformanceCheckStatus = "pass" | "fail" | "not-provided" | "unsupported";
export type ConformanceLayer = "subject-broker" | "agent-harness" | "host";

export interface ConformanceCheck {
  readonly id: string;
  readonly layer: ConformanceLayer;
  readonly status: ConformanceCheckStatus;
  readonly summary: string;
}

export interface ConformanceReport {
  readonly schemaVersion: 1;
  readonly subjectBrokerVersion: string;
  readonly fixture: "finance-support";
  readonly platform: string;
  readonly status: "pass" | "fail" | "unsupported";
  readonly checks: readonly ConformanceCheck[];
}

interface BrokerConnection {
  readonly client: Client;
  close(): Promise<void>;
}

const auditEventSchema = z
  .object({
    timestamp: z.iso.datetime(),
    subjectId: z.string(),
    resourceId: z.string(),
    action: z.literal("read"),
    decision: z.enum(["allow", "deny", "error"]),
    reasonCode: z.enum(REASON_CODES),
  })
  .strict();

function check(
  id: string,
  layer: ConformanceLayer,
  passed: boolean,
  passingSummary: string,
  failingSummary: string,
): ConformanceCheck {
  return {
    id,
    layer,
    status: passed ? "pass" : "fail",
    summary: passed ? passingSummary : failingSummary,
  };
}

function boundaryChecks(): readonly ConformanceCheck[] {
  return [
    {
      id: "harness.cross_subject_connection_isolation",
      layer: "agent-harness",
      status: "not-provided",
      summary:
        "SubjectBroker does not control which subject-bound MCP connections an agent harness exposes.",
    },
    {
      id: "host.direct_resource_isolation",
      layer: "host",
      status: "not-provided",
      summary:
        "SubjectBroker does not block direct same-user filesystem, shell, process, or credential access.",
    },
    {
      id: "host.non_transferable_subject_identity",
      layer: "host",
      status: "not-provided",
      summary:
        "The stdio prototype has process-bound configuration, not a non-transferable workload credential.",
    },
  ];
}

function parseToolText(result: unknown): Record<string, unknown> {
  if (typeof result !== "object" || result === null || !("content" in result)) {
    throw new Error("Tool result did not contain content");
  }
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    throw new Error("Tool result content was not an array");
  }
  const item = content.find(
    (candidate): candidate is { type: string; text: string } =>
      typeof candidate === "object" &&
      candidate !== null &&
      "type" in candidate &&
      candidate.type === "text" &&
      "text" in candidate &&
      typeof candidate.text === "string",
  );
  if (item?.text === undefined) {
    throw new Error("Tool result did not contain JSON text");
  }
  return JSON.parse(item.text) as Record<string, unknown>;
}

function sameStrings(actual: unknown, expected: readonly string[]): boolean {
  return (
    Array.isArray(actual) &&
    actual.every((item) => typeof item === "string") &&
    [...actual].sort().join("\u0000") === [...expected].sort().join("\u0000")
  );
}

function containsString(actual: unknown, expected: string): boolean {
  return Array.isArray(actual) && actual.includes(expected);
}

function isDecision(
  result: Record<string, unknown>,
  decision: "allow" | "deny",
  resourceId: string,
  content?: string,
): boolean {
  return (
    result.decision === decision &&
    result.reasonCode === (decision === "allow" ? "ALLOWED" : "ACCESS_DENIED") &&
    result.resourceId === resourceId &&
    (content === undefined ? !("content" in result) : result.content === content)
  );
}

async function connectBroker(
  broker: SubjectBroker,
  serverName: string,
): Promise<BrokerConnection> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer(broker, serverName);
  const client = new Client({ name: "subject-broker-conformance", version: "1.0.0" });
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

async function readAudit(auditPath: string) {
  const source = await readFile(auditPath, "utf8");
  return source
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => auditEventSchema.parse(JSON.parse(line)));
}

function unsupportedReport(platform: string): ConformanceReport {
  return {
    schemaVersion: 1,
    subjectBrokerVersion: SUBJECT_BROKER_VERSION,
    fixture: "finance-support",
    platform,
    status: "unsupported",
    checks: [
      {
        id: "broker.registered_resource_enforcement",
        layer: "subject-broker",
        status: "unsupported",
        summary: "The current hard-enforcement conformance fixture is supported only on macOS.",
      },
      ...boundaryChecks(),
    ],
  };
}

export async function runFinanceSupportConformance(
  platform: NodeJS.Platform = process.platform,
): Promise<ConformanceReport> {
  if (platform !== "darwin") {
    return unsupportedReport(platform);
  }

  const temporaryRoot = await realpath(os.tmpdir());
  const root = await mkdtemp(path.join(temporaryRoot, "subject-broker-conformance-"));
  const projectDirectory = path.join(root, "project");
  const storageRoot = path.join(root, "protected-storage");
  const financePath = path.join(storageRoot, "finance-transactions.txt");
  const supportPath = path.join(storageRoot, "support-tickets.txt");
  const policyPath = path.join(projectDirectory, "subject-broker.yaml");
  const parentAuditPath = path.join(root, "audit-parent.jsonl");
  const financeAuditPath = path.join(root, "audit-finance.jsonl");
  const supportAuditPath = path.join(root, "audit-support.jsonl");
  const connections: BrokerConnection[] = [];

  try {
    await mkdir(projectDirectory);
    await mkdir(storageRoot, { mode: 0o700 });
    await chmod(storageRoot, 0o700);
    await writeFile(financePath, `${FINANCE_CANARY}\n`, { mode: 0o600 });
    await writeFile(supportPath, `${SUPPORT_CANARY}\n`, { mode: 0o600 });
    await writeFile(
      policyPath,
      stringify({
        version: 1,
        storageRoot,
        subjects: ["parent", "finance-agent", "support-agent"],
        resources: {
          "finance-transactions": { path: financePath },
          "support-tickets": { path: supportPath },
        },
        rules: [
          {
            subject: "parent",
            resource: "finance-transactions",
            action: "read",
            decision: "allow",
          },
          {
            subject: "parent",
            resource: "support-tickets",
            action: "read",
            decision: "allow",
          },
          {
            subject: "finance-agent",
            resource: "finance-transactions",
            action: "read",
            decision: "allow",
          },
          {
            subject: "finance-agent",
            resource: "support-tickets",
            action: "read",
            decision: "deny",
          },
          {
            subject: "support-agent",
            resource: "finance-transactions",
            action: "read",
            decision: "deny",
          },
          {
            subject: "support-agent",
            resource: "support-tickets",
            action: "read",
            decision: "allow",
          },
        ],
      }),
      "utf8",
    );

    const createBroker = (subjectId: string, auditPath: string) =>
      SubjectBroker.create({
        policyPath,
        subjectId,
        auditPath,
        workingDirectory: projectDirectory,
        platform,
        failOnStartupError: true,
        now: () => new Date("2026-08-01T00:00:00.000Z"),
      });

    const parent = await connectBroker(
      await createBroker("parent", parentAuditPath),
      "sbParent",
    );
    const finance = await connectBroker(
      await createBroker("finance-agent", financeAuditPath),
      "sbFinance",
    );
    const support = await connectBroker(
      await createBroker("support-agent", supportAuditPath),
      "sbSupport",
    );
    connections.push(parent, finance, support);

    const list = async (connection: BrokerConnection) =>
      parseToolText(
        await connection.client.callTool({ name: "list_resources", arguments: {} }),
      );
    const read = async (
      connection: BrokerConnection,
      resourceId: string,
      extraArguments: Record<string, unknown> = {},
    ) =>
      parseToolText(
        await connection.client.callTool({
          name: "read_resource",
          arguments: { resourceId, ...extraArguments },
        }),
      );

    const parentList = await list(parent);
    const financeList = await list(finance);
    const supportList = await list(support);
    const parentFinance = await read(parent, "finance-transactions");
    const parentSupport = await read(parent, "support-tickets");
    const financeAllowed = await read(finance, "finance-transactions");
    const financeDenied = await read(finance, "support-tickets");
    const financeSpoofDenied = await read(finance, "support-tickets", {
      subject: "support-agent",
      subjectId: "support-agent",
      identity: { subject: "support-agent" },
    });
    const supportAllowed = await read(support, "support-tickets");
    const supportDenied = await read(support, "finance-transactions");

    const parentAudit = await readAudit(parentAuditPath);
    const financeAudit = await readAudit(financeAuditPath);
    const supportAudit = await readAudit(supportAuditPath);
    const serializedAudits = JSON.stringify([parentAudit, financeAudit, supportAudit]);

    const checks: ConformanceCheck[] = [
      check(
        "broker.parent_authority_control",
        "subject-broker",
        sameStrings(parentList.resources, ["finance-transactions", "support-tickets"]) &&
          isDecision(parentFinance, "allow", "finance-transactions", `${FINANCE_CANARY}\n`) &&
          isDecision(parentSupport, "allow", "support-tickets", `${SUPPORT_CANARY}\n`),
        "The parent subject exercised both explicitly allowed resources.",
        "The parent subject did not exercise its expected two-resource authority.",
      ),
      check(
        "broker.authorized_resource_listing",
        "subject-broker",
        sameStrings(financeList.resources, ["finance-transactions"]) &&
          sameStrings(supportList.resources, ["support-tickets"]),
        "Each child subject listed only its explicitly allowed resource.",
        "A child subject did not receive the expected resource listing.",
      ),
      check(
        "broker.unauthorized_resource_hidden",
        "subject-broker",
        !containsString(financeList.resources, "support-tickets") &&
          !containsString(supportList.resources, "finance-transactions"),
        "Unauthorized resource identifiers were absent from each child listing.",
        "An unauthorized resource identifier appeared in a child listing.",
      ),
      check(
        "broker.direct_hidden_resource_call_denied",
        "subject-broker",
        isDecision(financeDenied, "deny", "support-tickets") &&
          isDecision(supportDenied, "deny", "finance-transactions") &&
          !JSON.stringify([financeDenied, supportDenied]).includes(FINANCE_CANARY) &&
          !JSON.stringify([financeDenied, supportDenied]).includes(SUPPORT_CANARY),
        "Exact calls to known but unauthorized resource identifiers were denied without content.",
        "A direct unauthorized resource call was not safely denied.",
      ),
      check(
        "broker.request_identity_spoofing_denied",
        "subject-broker",
        isDecision(financeSpoofDenied, "deny", "support-tickets"),
        "Caller-supplied identity fields did not replace the process-bound finance subject.",
        "Caller-supplied identity fields affected the process-bound subject decision.",
      ),
      check(
        "broker.subject_specific_authority",
        "subject-broker",
        isDecision(financeAllowed, "allow", "finance-transactions", `${FINANCE_CANARY}\n`) &&
          isDecision(supportAllowed, "allow", "support-tickets", `${SUPPORT_CANARY}\n`),
        "Starting the same policy under different subjects produced different effective authority.",
        "Subject-specific broker instances did not produce the expected authority.",
      ),
      check(
        "broker.subject_aware_metadata_only_audit",
        "subject-broker",
        parentAudit.length === 2 &&
          parentAudit.every(
            (event) => event.subjectId === "parent" && event.decision === "allow",
          ) &&
          financeAudit.length === 3 &&
          financeAudit.every((event) => event.subjectId === "finance-agent") &&
          supportAudit.length === 2 &&
          supportAudit.every((event) => event.subjectId === "support-agent") &&
          !serializedAudits.includes(FINANCE_CANARY) &&
          !serializedAudits.includes(SUPPORT_CANARY) &&
          !serializedAudits.includes(storageRoot),
        "Every tested read produced a subject-bound metadata-only audit event.",
        "The audit evidence was incomplete, misattributed, or contained protected data.",
      ),
      ...boundaryChecks(),
    ];

    return {
      schemaVersion: 1,
      subjectBrokerVersion: SUBJECT_BROKER_VERSION,
      fixture: "finance-support",
      platform,
      status: checks.some((candidate) => candidate.status === "fail") ? "fail" : "pass",
      checks,
    };
  } catch {
    return {
      schemaVersion: 1,
      subjectBrokerVersion: SUBJECT_BROKER_VERSION,
      fixture: "finance-support",
      platform,
      status: "fail",
      checks: [
        {
          id: "broker.conformance_execution",
          layer: "subject-broker",
          status: "fail",
          summary: "The conformance fixture did not complete; protected details were suppressed.",
        },
        ...boundaryChecks(),
      ],
    };
  } finally {
    await Promise.all(
      connections.map((connection) => connection.close().catch(() => undefined)),
    );
    await rm(root, { recursive: true, force: true });
  }
}

async function runCli(): Promise<void> {
  const report = await runFinanceSupportConformance();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.status === "pass" ? 0 : report.status === "unsupported" ? 2 : 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runCli();
}
