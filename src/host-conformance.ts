#!/usr/bin/env node
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  link,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { stringify } from "yaml";
import { SUBJECT_BROKER_VERSION } from "./capability.js";
import {
  buildMacOSSandboxProfile,
  type HostIsolationBoundary,
  resolveHostIsolationBoundary,
} from "./isolated-opencode.js";
import { startSocketBroker, type SocketBrokerHandle } from "./socket-broker.js";
import { UnixSocketClientTransport } from "./unix-socket-transport.js";

const execFileAsync = promisify(execFile);
const FINANCE_CANARY = "HOST_FINANCE_CANARY_7c30d2";
const SUPPORT_CANARY = "HOST_SUPPORT_CANARY_a981ef";

type HostCheckStatus = "pass" | "fail" | "not-provided" | "unsupported";
type HostCheckLayer = "subject-broker" | "agent-harness" | "host";

interface HostCheck {
  readonly id: string;
  readonly layer: HostCheckLayer;
  readonly status: HostCheckStatus;
  readonly summary: string;
}

export interface HostConformanceReport {
  readonly schemaVersion: 1;
  readonly subjectBrokerVersion: string;
  readonly fixture: "macos-isolated-finance";
  readonly platform: string;
  readonly hostMechanism: "sandbox-exec";
  readonly status: "pass" | "fail" | "unsupported";
  readonly enforcementLevels: {
    readonly subjectBroker: "enforced" | "not-exercised" | "unsupported";
    readonly agentHarness: "not-exercised";
    readonly hostResource: "enforced" | "not-exercised" | "unsupported";
    readonly subjectIdentity: "not-provided";
  };
  readonly checks: readonly HostCheck[];
}

interface ProbeResult {
  readonly directResourceRead: string;
  readonly symlinkAliasRead: string;
  readonly policyRead: string;
  readonly auditRead: string;
  readonly authorizedBrokerHashMatches: boolean;
  readonly unauthorizedBrokerDecision: string;
  readonly unauthorizedBrokerHasContent: boolean;
  readonly assignedSocketRemoval: string;
  readonly protectedHardLinkCreation: string;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function parseToolText(result: unknown): Record<string, unknown> {
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    throw new Error("Missing MCP content");
  }
  const text = content.find(
    (item): item is { type: "text"; text: string } =>
      typeof item === "object" &&
      item !== null &&
      (item as { type?: unknown }).type === "text" &&
      typeof (item as { text?: unknown }).text === "string",
  );
  if (text === undefined) {
    throw new Error("Missing MCP text result");
  }
  return JSON.parse(text.text) as Record<string, unknown>;
}

async function attemptedRead(filePath: string): Promise<string> {
  try {
    await readFile(filePath, "utf8");
    return "readable";
  } catch (error) {
    return (error as NodeJS.ErrnoException).code ?? "error";
  }
}

async function runProbe(args: readonly string[]): Promise<void> {
  if (args.length !== 6) {
    throw new Error("Invalid host probe arguments");
  }
  const [socketPath, resourcePath, aliasPath, policyPath, auditPath, expectedHash] = args;
  if (
    socketPath === undefined ||
    resourcePath === undefined ||
    aliasPath === undefined ||
    policyPath === undefined ||
    auditPath === undefined ||
    expectedHash === undefined
  ) {
    throw new Error("Invalid host probe arguments");
  }

  const directResourceRead = await attemptedRead(resourcePath);
  const symlinkAliasRead = await attemptedRead(aliasPath);
  const policyRead = await attemptedRead(policyPath);
  const auditRead = await attemptedRead(auditPath);
  const transport = new UnixSocketClientTransport(socketPath);
  const client = new Client({ name: "host-conformance-probe", version: "1.0.0" });
  await client.connect(transport);
  try {
    const authorized = parseToolText(
      await client.callTool({
        name: "read_resource",
        arguments: { resourceId: "finance-transactions" },
      }),
    );
    const unauthorized = parseToolText(
      await client.callTool({
        name: "read_resource",
        arguments: { resourceId: "support-tickets" },
      }),
    );
    let assignedSocketRemoval = "removed";
    try {
      await unlink(socketPath);
    } catch (error) {
      assignedSocketRemoval = (error as NodeJS.ErrnoException).code ?? "error";
    }
    let protectedHardLinkCreation = "created";
    try {
      await link(resourcePath, path.join(path.dirname(aliasPath), "hard-link-attempt.txt"));
    } catch (error) {
      protectedHardLinkCreation = (error as NodeJS.ErrnoException).code ?? "error";
    }
    const result: ProbeResult = {
      directResourceRead,
      symlinkAliasRead,
      policyRead,
      auditRead,
      authorizedBrokerHashMatches:
        typeof authorized.content === "string" && hash(authorized.content) === expectedHash,
      unauthorizedBrokerDecision: String(unauthorized.decision),
      unauthorizedBrokerHasContent: "content" in unauthorized,
      assignedSocketRemoval,
      protectedHardLinkCreation,
    };
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    await client.close();
  }
}

function resultCheck(
  id: string,
  layer: HostCheckLayer,
  passed: boolean,
  passingSummary: string,
  failingSummary: string,
): HostCheck {
  return {
    id,
    layer,
    status: passed ? "pass" : "fail",
    summary: passed ? passingSummary : failingSummary,
  };
}

function unsupportedReport(platform: string): HostConformanceReport {
  return {
    schemaVersion: 1,
    subjectBrokerVersion: SUBJECT_BROKER_VERSION,
    fixture: "macos-isolated-finance",
    platform,
    hostMechanism: "sandbox-exec",
    status: "unsupported",
    enforcementLevels: {
      subjectBroker: "unsupported",
      agentHarness: "not-exercised",
      hostResource: "unsupported",
      subjectIdentity: "not-provided",
    },
    checks: [
      {
        id: "host.macos_sandbox_profile",
        layer: "host",
        status: "unsupported",
        summary: "The version-pinned reference host profile is available only on macOS.",
      },
    ],
  };
}

export async function runHostConformance(
  platform: NodeJS.Platform = process.platform,
): Promise<HostConformanceReport> {
  if (platform !== "darwin") {
    return unsupportedReport(platform);
  }

  const root = await mkdtemp("/private/tmp/sb-host-");
  const workspace = path.join(root, "workspace");
  const trustRoot = path.join(root, "trusted");
  const capabilityDirectory = path.join(root, "capability");
  const storageRoot = path.join(trustRoot, "protected-storage");
  const financePath = path.join(storageRoot, "finance.txt");
  const supportPath = path.join(storageRoot, "support.txt");
  const aliasPath = path.join(workspace, "finance-alias.txt");
  const policyPath = path.join(trustRoot, "policy.yaml");
  const auditPath = path.join(trustRoot, "audit.jsonl");
  const socketPath = path.join(capabilityDirectory, "finance.sock");
  let brokerHandle: SocketBrokerHandle | undefined;
  let preexistingHardLinkRefused = false;
  try {
    await mkdir(workspace, { mode: 0o700 });
    await mkdir(trustRoot, { mode: 0o700 });
    await mkdir(capabilityDirectory, { mode: 0o700 });
    await mkdir(storageRoot, { mode: 0o700 });
    await chmod(storageRoot, 0o700);
    await writeFile(financePath, FINANCE_CANARY, { mode: 0o600 });
    await writeFile(supportPath, SUPPORT_CANARY, { mode: 0o600 });
    await symlink(financePath, aliasPath);
    await writeFile(
      policyPath,
      stringify({
        version: 1,
        storageRoot,
        subjects: ["finance-agent"],
        resources: {
          "finance-transactions": { path: financePath },
          "support-tickets": { path: supportPath },
        },
        rules: [
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
        ],
      }),
      { mode: 0o600 },
    );
    const preexistingHardLinkPath = path.join(workspace, "preexisting-hard-link.txt");
    await link(financePath, preexistingHardLinkPath);
    try {
      await resolveHostIsolationBoundary({ workspace, policyPath, auditPath });
    } catch (error) {
      preexistingHardLinkRefused =
        (error as { code?: unknown }).code === "HOST_BOUNDARY_INVALID";
    } finally {
      await unlink(preexistingHardLinkPath);
    }
    brokerHandle = await startSocketBroker(
      {
        policyPath,
        subjectId: "finance-agent",
        auditPath,
        failOnStartupError: true,
      },
      "sbFinanceAgent",
      socketPath,
    );
    const boundary: HostIsolationBoundary = {
      workspace,
      trustRoot,
      policyPath,
      auditPath,
      storageRoot,
    };
    const { stdout } = await execFileAsync(
      "/usr/bin/sandbox-exec",
      [
        "-p",
        buildMacOSSandboxProfile(boundary, undefined, capabilityDirectory),
        process.execPath,
        fileURLToPath(import.meta.url),
        "--probe",
        socketPath,
        financePath,
        aliasPath,
        policyPath,
        auditPath,
        hash(FINANCE_CANARY),
      ],
      { cwd: workspace, encoding: "utf8" },
    );
    const probe = JSON.parse(stdout) as ProbeResult;
    const audit = await readFile(auditPath, "utf8");
    const checks: HostCheck[] = [
      resultCheck(
        "host.direct_resource_read_blocked",
        "host",
        probe.directResourceRead === "EPERM",
        "The sandboxed workload could not read protected storage directly.",
        "The sandboxed workload could read protected storage directly.",
      ),
      resultCheck(
        "host.symlink_alias_read_blocked",
        "host",
        probe.symlinkAliasRead === "EPERM",
        "A workspace symlink did not bypass the protected-storage denial.",
        "A workspace symlink bypassed the protected-storage denial.",
      ),
      resultCheck(
        "host.policy_configuration_hidden",
        "host",
        probe.policyRead === "EPERM",
        "The sandboxed workload could not read trusted policy configuration.",
        "The sandboxed workload could read trusted policy configuration.",
      ),
      resultCheck(
        "host.audit_destination_protected",
        "host",
        probe.auditRead === "EPERM",
        "The sandboxed workload could not read the audit destination.",
        "The sandboxed workload could read the audit destination.",
      ),
      resultCheck(
        "broker.authorized_socket_read",
        "subject-broker",
        probe.authorizedBrokerHashMatches,
        "The external subject-bound broker released the authorized resource through its socket.",
        "The authorized broker path did not return the registered resource.",
      ),
      resultCheck(
        "broker.unauthorized_socket_read_denied",
        "subject-broker",
        probe.unauthorizedBrokerDecision === "deny" && !probe.unauthorizedBrokerHasContent,
        "The same socket denied the known unauthorized resource without content.",
        "The same socket did not safely deny the unauthorized resource.",
      ),
      resultCheck(
        "host.broker_outside_sandbox_differential",
        "host",
        probe.directResourceRead === "EPERM" && probe.authorizedBrokerHashMatches,
        "Direct access failed while the external broker path remained functional.",
        "The test did not establish a working broker outside a denied direct path.",
      ),
      resultCheck(
        "host.assigned_socket_write_protected",
        "host",
        probe.assignedSocketRemoval === "EPERM",
        "The sandboxed workload could use but not unlink its assigned broker socket.",
        "The sandboxed workload could mutate its assigned broker socket path.",
      ),
      resultCheck(
        "host.protected_hard_link_creation_blocked",
        "host",
        probe.protectedHardLinkCreation === "EPERM",
        "The sandboxed workload could not create a new hard-link alias to protected storage.",
        "The sandboxed workload created a hard-link alias to protected storage.",
      ),
      resultCheck(
        "host.preexisting_hard_link_refused",
        "host",
        preexistingHardLinkRefused,
        "The trusted preflight rejected a registered resource with a pre-existing hard link.",
        "The trusted preflight accepted a registered resource with a pre-existing hard link.",
      ),
      resultCheck(
        "broker.metadata_only_audit",
        "subject-broker",
        audit.includes('"subjectId":"finance-agent"') &&
          audit.includes('"decision":"allow"') &&
          audit.includes('"decision":"deny"') &&
          !audit.includes(FINANCE_CANARY) &&
          !audit.includes(SUPPORT_CANARY),
        "The differential produced subject-aware metadata-only audit records.",
        "The differential did not produce the expected safe audit records.",
      ),
      {
        id: "host.non_transferable_subject_identity",
        layer: "host",
        status: "not-provided",
        summary:
          "The assigned Unix socket is a local bearer capability, not a non-transferable workload identity.",
      },
      {
        id: "host.portable_supported_sandbox",
        layer: "host",
        status: "not-provided",
        summary:
          "Apple deprecates sandbox-exec; this is a version-pinned research profile, not a portable production sandbox.",
      },
    ];
    return {
      schemaVersion: 1,
      subjectBrokerVersion: SUBJECT_BROKER_VERSION,
      fixture: "macos-isolated-finance",
      platform,
      hostMechanism: "sandbox-exec",
      status: checks.some((check) => check.status === "fail") ? "fail" : "pass",
      enforcementLevels: {
        subjectBroker: "enforced",
        agentHarness: "not-exercised",
        hostResource: "enforced",
        subjectIdentity: "not-provided",
      },
      checks,
    };
  } catch {
    return {
      schemaVersion: 1,
      subjectBrokerVersion: SUBJECT_BROKER_VERSION,
      fixture: "macos-isolated-finance",
      platform,
      hostMechanism: "sandbox-exec",
      status: "fail",
      enforcementLevels: {
        subjectBroker: "not-exercised",
        agentHarness: "not-exercised",
        hostResource: "not-exercised",
        subjectIdentity: "not-provided",
      },
      checks: [
        {
          id: "host.conformance_execution",
          layer: "host",
          status: "fail",
          summary:
            "The host differential did not complete; protected details were suppressed.",
        },
        {
          id: "host.non_transferable_subject_identity",
          layer: "host",
          status: "not-provided",
          summary:
            "The reference topology does not provide non-transferable workload identity.",
        },
      ],
    };
  } finally {
    await brokerHandle?.close().catch(() => undefined);
    await rm(root, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function runCli(): Promise<void> {
  if (process.argv[2] === "--probe") {
    await runProbe(process.argv.slice(3));
    return;
  }
  const report = await runHostConformance();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.status === "pass" ? 0 : report.status === "unsupported" ? 2 : 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runCli();
}
