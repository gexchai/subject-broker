export const ACTION_READ = "read" as const;

export const REASON_CODES = [
  "ALLOWED",
  "ACCESS_DENIED",
  "POLICY_UNAVAILABLE",
  "RESOURCE_CHANGED",
  "RESOURCE_TOO_LARGE",
  "RESOURCE_ENCODING_INVALID",
  "AUDIT_FAILED",
  "PLATFORM_UNSUPPORTED",
  "INTERNAL_ERROR",
] as const;

export type ReasonCode = (typeof REASON_CODES)[number];
export type Decision = "allow" | "deny" | "error";

export interface Rule {
  readonly subject: string;
  readonly resource: string;
  readonly action: typeof ACTION_READ;
  readonly decision: "allow" | "deny";
}

export interface ResourceDefinition {
  readonly path: string;
}

export interface Policy {
  readonly version: 1;
  readonly storageRoot: string;
  readonly subjects: readonly string[];
  readonly resources: Readonly<Record<string, ResourceDefinition>>;
  readonly rules: readonly Rule[];
}

export interface PolicyDecision {
  readonly decision: "allow" | "deny";
  readonly reasonCode: "ALLOWED" | "ACCESS_DENIED" | "POLICY_UNAVAILABLE" | "PLATFORM_UNSUPPORTED";
}

export interface AuditEvent {
  readonly timestamp: string;
  readonly subjectId: string;
  readonly resourceId: string;
  readonly action: typeof ACTION_READ;
  readonly decision: Decision;
  readonly reasonCode: ReasonCode;
}

export interface CapabilityReport {
  readonly version: string;
  readonly platform: string;
  readonly activeEnforcementLevel: "hard-enforcement" | "unsupported";
  readonly coveredOperation: string;
  readonly subjectBinding: string;
  readonly policyLoaded: boolean;
  readonly assumptions: readonly string[];
  readonly uncoveredPaths: readonly string[];
}
