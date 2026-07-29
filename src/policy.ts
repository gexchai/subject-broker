import { parseDocument } from "yaml";
import { z } from "zod";
import { ACTION_READ, type Policy, type PolicyDecision } from "./model.js";

const identifier = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u);

const resourceSchema = z
  .object({
    path: z.string().min(1),
  })
  .strict();

const ruleSchema = z
  .object({
    subject: identifier,
    resource: identifier,
    action: z.literal(ACTION_READ),
    decision: z.enum(["allow", "deny"]),
  })
  .strict();

const policySchema = z
  .object({
    version: z.literal(1),
    storageRoot: z.string().min(1),
    subjects: z.array(identifier).min(1),
    resources: z.record(identifier, resourceSchema),
    rules: z.array(ruleSchema),
  })
  .strict();

export class PolicyLoadError extends Error {
  public constructor() {
    super("Policy is unavailable");
    this.name = "PolicyLoadError";
  }
}

function assertUnique(values: readonly string[]): void {
  if (new Set(values).size !== values.length) {
    throw new PolicyLoadError();
  }
}

export function parsePolicy(source: string): Policy {
  try {
    const document = parseDocument(source, {
      merge: false,
      strict: true,
      uniqueKeys: true,
    });
    if (document.errors.length > 0) {
      throw new PolicyLoadError();
    }

    const parsed = policySchema.parse(document.toJS({ maxAliasCount: 0 }));
    assertUnique(parsed.subjects);

    const subjects = new Set(parsed.subjects);
    const resources = new Set(Object.keys(parsed.resources));
    const ruleKeys = new Set<string>();

    for (const rule of parsed.rules) {
      if (!subjects.has(rule.subject) || !resources.has(rule.resource)) {
        throw new PolicyLoadError();
      }
      const key = `${rule.subject}\u0000${rule.resource}\u0000${rule.action}`;
      if (ruleKeys.has(key)) {
        throw new PolicyLoadError();
      }
      ruleKeys.add(key);
    }

    return parsed;
  } catch (error) {
    if (error instanceof PolicyLoadError) {
      throw error;
    }
    throw new PolicyLoadError();
  }
}

export function evaluate(
  policy: Policy | undefined,
  platformSupported: boolean,
  subjectId: string,
  resourceId: string,
  action: string,
): PolicyDecision {
  if (!platformSupported) {
    return { decision: "deny", reasonCode: "PLATFORM_UNSUPPORTED" };
  }
  if (policy === undefined) {
    return { decision: "deny", reasonCode: "POLICY_UNAVAILABLE" };
  }
  if (action !== ACTION_READ || !policy.subjects.includes(subjectId)) {
    return { decision: "deny", reasonCode: "ACCESS_DENIED" };
  }

  const rule = policy.rules.find(
    (candidate) =>
      candidate.subject === subjectId &&
      candidate.resource === resourceId &&
      candidate.action === ACTION_READ,
  );

  if (rule?.decision === "allow") {
    return { decision: "allow", reasonCode: "ALLOWED" };
  }
  return { decision: "deny", reasonCode: "ACCESS_DENIED" };
}
