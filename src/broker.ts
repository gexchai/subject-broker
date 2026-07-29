import { readFile } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import type { AuditWriter } from "./audit.js";
import {
  AuditConfigurationError,
  AuditFailureError,
  JsonlAuditWriter,
  type AuditFailureCode,
  validateAuditDestination,
} from "./audit.js";
import { createCapabilityReport } from "./capability.js";
import {
  ACTION_READ,
  type AuditEvent,
  type CapabilityReport,
  type Policy,
  type ReasonCode,
} from "./model.js";
import { evaluate, parsePolicy } from "./policy.js";
import {
  RegistryError,
  ResourceChangedError,
  ResourceRegistry,
  type RegistryErrorCode,
} from "./resource-registry.js";

export const DEFAULT_MAX_RESOURCE_BYTES = 1024 * 1024;

export type StartupDiagnosticCode =
  | "POLICY_FILE_UNAVAILABLE"
  | "POLICY_PARSE_ERROR"
  | "AUDIT_DESTINATION_INVALID"
  | RegistryErrorCode;

export class StartupConfigurationError extends Error {
  public readonly code: StartupDiagnosticCode;

  public constructor(code: StartupDiagnosticCode) {
    super(`SubjectBroker startup configuration failed: ${code}`);
    this.name = "StartupConfigurationError";
    this.code = code;
  }
}

class ResourceTooLargeError extends Error {}
class ResourceEncodingError extends Error {}

export interface BrokerHooks {
  readonly beforeResourceOpen?: () => Promise<void>;
}

export interface BrokerOptions {
  readonly policyPath: string;
  readonly subjectId: string;
  readonly auditPath: string;
  readonly workingDirectory?: string;
  readonly platform?: NodeJS.Platform;
  readonly auditWriter?: AuditWriter;
  readonly now?: () => Date;
  readonly hooks?: BrokerHooks;
  readonly failOnStartupError?: boolean;
  readonly maxResourceBytes?: number;
  readonly onDiagnostic?: (code: AuditFailureCode) => void;
}

export interface BrokerResult {
  readonly decision: "allow" | "deny" | "error";
  readonly reasonCode: ReasonCode;
  readonly resourceId: string;
  readonly content?: string;
}

export interface ExplainResult {
  readonly decision: "allow" | "deny";
  readonly reasonCode: ReasonCode;
  readonly resourceId: string;
  readonly action: string;
}

async function loadPolicyAndRegistry(
  policyPath: string,
  workingDirectory: string,
): Promise<
  | { loaded: { policy: Policy; registry: ResourceRegistry } }
  | { failure: StartupDiagnosticCode }
> {
  let source: string;
  try {
    source = await readFile(policyPath, "utf8");
  } catch {
    return { failure: "POLICY_FILE_UNAVAILABLE" };
  }

  try {
    const policy = parsePolicy(source);
    return await loadRegistry(policy, workingDirectory);
  } catch {
    return { failure: "POLICY_PARSE_ERROR" };
  }
}

async function loadRegistry(
  policy: Policy,
  workingDirectory: string,
): Promise<
  | { loaded: { policy: Policy; registry: ResourceRegistry } }
  | { failure: StartupDiagnosticCode }
> {
  try {
    const registry = await ResourceRegistry.create(
      policy.storageRoot,
      policy.resources,
      workingDirectory,
    );
    return { loaded: { policy, registry } };
  } catch (error) {
    return {
      failure:
        error instanceof RegistryError ? error.code : "RESOURCE_CONFIGURATION_INVALID",
    };
  }
}

async function readUtf8Text(handle: FileHandle, maximumBytes: number): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;

  while (total <= maximumBytes) {
    const remaining = maximumBytes + 1 - total;
    const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, remaining));
    const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
    if (bytesRead === 0) {
      break;
    }
    chunks.push(chunk.subarray(0, bytesRead));
    total += bytesRead;
  }

  if (total > maximumBytes) {
    throw new ResourceTooLargeError();
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, total));
  } catch {
    throw new ResourceEncodingError();
  }
}

export class SubjectBroker {
  readonly #subjectId: string;
  readonly #policy: Policy | undefined;
  readonly #registry: ResourceRegistry | undefined;
  readonly #audit: AuditWriter;
  readonly #platform: NodeJS.Platform;
  readonly #now: () => Date;
  readonly #hooks: BrokerHooks;
  readonly #maxResourceBytes: number;
  readonly #onDiagnostic: (code: AuditFailureCode) => void;

  private constructor(
    options: BrokerOptions,
    loaded: { policy: Policy; registry: ResourceRegistry } | undefined,
  ) {
    this.#subjectId = options.subjectId;
    this.#policy = loaded?.policy;
    this.#registry = loaded?.registry;
    this.#audit = options.auditWriter ?? new JsonlAuditWriter(options.auditPath);
    this.#platform = options.platform ?? process.platform;
    this.#now = options.now ?? (() => new Date());
    this.#hooks = options.hooks ?? {};
    this.#maxResourceBytes = options.maxResourceBytes ?? DEFAULT_MAX_RESOURCE_BYTES;
    this.#onDiagnostic = options.onDiagnostic ?? (() => undefined);
  }

  public static async create(options: BrokerOptions): Promise<SubjectBroker> {
    const maximumBytes = options.maxResourceBytes ?? DEFAULT_MAX_RESOURCE_BYTES;
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes <= 0) {
      throw new TypeError("maxResourceBytes must be a positive safe integer");
    }

    const result = await loadPolicyAndRegistry(
      options.policyPath,
      options.workingDirectory ?? process.cwd(),
    );
    if ("failure" in result) {
      if (options.failOnStartupError === true) {
        throw new StartupConfigurationError(result.failure);
      }
      return new SubjectBroker(options, undefined);
    }
    if (options.failOnStartupError === true && options.auditWriter === undefined) {
      try {
        await validateAuditDestination(options.auditPath);
      } catch (error) {
        if (error instanceof AuditConfigurationError) {
          throw new StartupConfigurationError("AUDIT_DESTINATION_INVALID");
        }
        throw error;
      }
    }
    return new SubjectBroker(options, result.loaded);
  }

  public get subjectId(): string {
    return this.#subjectId;
  }

  public capabilityReport(): CapabilityReport {
    return createCapabilityReport(this.#platform, this.#policy !== undefined);
  }

  public listResources(): { resources: readonly string[]; reasonCode: ReasonCode } {
    if (this.#platform !== "darwin") {
      return { resources: [], reasonCode: "PLATFORM_UNSUPPORTED" };
    }
    if (this.#policy === undefined || this.#registry === undefined) {
      return { resources: [], reasonCode: "POLICY_UNAVAILABLE" };
    }
    const visible = this.#registry
      .ids()
      .filter(
        (resourceId) =>
          evaluate(this.#policy, true, this.#subjectId, resourceId, ACTION_READ).decision ===
          "allow",
      );
    return { resources: visible, reasonCode: "ALLOWED" };
  }

  public explain(resourceId: string, action: string): ExplainResult {
    const result = evaluate(
      this.#policy,
      this.#platform === "darwin",
      this.#subjectId,
      resourceId,
      action,
    );
    return {
      decision: result.decision,
      reasonCode: result.reasonCode,
      resourceId,
      action,
    };
  }

  public async readResource(resourceId: string): Promise<BrokerResult> {
    const policyDecision = evaluate(
      this.#policy,
      this.#platform === "darwin",
      this.#subjectId,
      resourceId,
      ACTION_READ,
    );

    if (policyDecision.decision === "deny") {
      return this.#auditAndReturn(resourceId, "deny", policyDecision.reasonCode);
    }

    try {
      await this.#hooks.beforeResourceOpen?.();
      if (this.#registry === undefined) {
        return this.#auditAndReturn(resourceId, "error", "POLICY_UNAVAILABLE");
      }
      const handle = await this.#registry.openVerified(resourceId);
      let content: string;
      try {
        content = await readUtf8Text(handle, this.#maxResourceBytes);
      } finally {
        await handle.close();
      }
      const audited = await this.#appendAudit(resourceId, "allow", "ALLOWED");
      if (!audited) {
        return { decision: "error", reasonCode: "AUDIT_FAILED", resourceId };
      }
      return { decision: "allow", reasonCode: "ALLOWED", resourceId, content };
    } catch (error) {
      let reasonCode: ReasonCode = "INTERNAL_ERROR";
      if (error instanceof ResourceChangedError) {
        reasonCode = "RESOURCE_CHANGED";
      } else if (error instanceof ResourceTooLargeError) {
        reasonCode = "RESOURCE_TOO_LARGE";
      } else if (error instanceof ResourceEncodingError) {
        reasonCode = "RESOURCE_ENCODING_INVALID";
      }
      return this.#auditAndReturn(resourceId, "error", reasonCode);
    }
  }

  async #auditAndReturn(
    resourceId: string,
    decision: "deny" | "error",
    reasonCode: ReasonCode,
  ): Promise<BrokerResult> {
    const audited = await this.#appendAudit(resourceId, decision, reasonCode);
    if (!audited) {
      return { decision: "error", reasonCode: "AUDIT_FAILED", resourceId };
    }
    return { decision, reasonCode, resourceId };
  }

  async #appendAudit(
    resourceId: string,
    decision: "allow" | "deny" | "error",
    reasonCode: ReasonCode,
  ): Promise<boolean> {
    const event: AuditEvent = {
      timestamp: this.#now().toISOString(),
      subjectId: this.#subjectId,
      resourceId,
      action: ACTION_READ,
      decision,
      reasonCode,
    };
    try {
      await this.#audit.append(event);
      return true;
    } catch (error) {
      try {
        this.#onDiagnostic(
          error instanceof AuditFailureError ? error.code : "AUDIT_WRITE_FAILED",
        );
      } catch {
        // Diagnostics must never displace the fail-closed audit result.
      }
      return false;
    }
  }
}
