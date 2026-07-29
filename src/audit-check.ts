#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import {
  ACTION_READ,
  REASON_CODES,
  type AuditEvent,
} from "./model.js";

const auditEventSchema = z
  .object({
    timestamp: z.string().refine((value) => !Number.isNaN(Date.parse(value))),
    subjectId: z.string().min(1),
    resourceId: z.string().min(1),
    action: z.literal(ACTION_READ),
    decision: z.enum(["allow", "deny", "error"]),
    reasonCode: z.enum(REASON_CODES),
  })
  .strict();

export interface LocatedAuditEvent extends AuditEvent {
  readonly source: string;
  readonly line: number;
}

export interface CrossSubjectFinding {
  readonly kind: "CROSS_SUBJECT_DENY_THEN_ALLOW";
  readonly resourceId: string;
  readonly elapsedMilliseconds: number;
  readonly denied: {
    readonly timestamp: string;
    readonly subjectId: string;
    readonly source: string;
    readonly line: number;
  };
  readonly allowed: {
    readonly timestamp: string;
    readonly subjectId: string;
    readonly source: string;
    readonly line: number;
  };
}

export interface AuditCheckArguments {
  readonly paths: readonly string[];
  readonly windowMilliseconds: number;
}

export function parseAuditJsonl(source: string, sourceName: string): LocatedAuditEvent[] {
  const events: LocatedAuditEvent[] = [];
  for (const [index, rawLine] of source.split("\n").entries()) {
    const line = rawLine.trim();
    if (line === "") {
      continue;
    }
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      throw new Error("INVALID_AUDIT_INPUT");
    }
    const parsed = auditEventSchema.safeParse(value);
    if (!parsed.success) {
      throw new Error("INVALID_AUDIT_INPUT");
    }
    events.push({
      ...parsed.data,
      source: sourceName,
      line: index + 1,
    });
  }
  return events;
}

export function findCrossSubjectFindings(
  inputEvents: readonly LocatedAuditEvent[],
  windowMilliseconds: number,
): CrossSubjectFinding[] {
  if (!Number.isSafeInteger(windowMilliseconds) || windowMilliseconds <= 0) {
    throw new TypeError("windowMilliseconds must be a positive safe integer");
  }

  const events = [...inputEvents].sort((left, right) => {
    const timeDifference =
      Date.parse(left.timestamp) - Date.parse(right.timestamp);
    if (timeDifference !== 0) {
      return timeDifference;
    }
    if (left.source !== right.source) {
      return left.source.localeCompare(right.source);
    }
    return left.line - right.line;
  });
  const recentDenials = new Map<string, LocatedAuditEvent[]>();
  const findings: CrossSubjectFinding[] = [];

  for (const event of events) {
    const eventTime = Date.parse(event.timestamp);
    const candidates = (recentDenials.get(event.resourceId) ?? []).filter(
      (denial) => eventTime - Date.parse(denial.timestamp) <= windowMilliseconds,
    );
    recentDenials.set(event.resourceId, candidates);

    if (event.decision === "deny") {
      candidates.push(event);
      continue;
    }
    if (event.decision !== "allow") {
      continue;
    }

    for (const denial of candidates) {
      if (denial.subjectId === event.subjectId) {
        continue;
      }
      findings.push({
        kind: "CROSS_SUBJECT_DENY_THEN_ALLOW",
        resourceId: event.resourceId,
        elapsedMilliseconds: eventTime - Date.parse(denial.timestamp),
        denied: {
          timestamp: denial.timestamp,
          subjectId: denial.subjectId,
          source: denial.source,
          line: denial.line,
        },
        allowed: {
          timestamp: event.timestamp,
          subjectId: event.subjectId,
          source: event.source,
          line: event.line,
        },
      });
    }
  }

  return findings;
}

export function parseAuditCheckArguments(args: readonly string[]): AuditCheckArguments {
  const paths: string[] = [];
  let windowMilliseconds = 10_000;

  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === "--window-seconds") {
      const secondsInput = args[index + 1];
      if (secondsInput === undefined) {
        throw new Error("INVALID_ARGUMENTS");
      }
      const seconds = Number(secondsInput);
      const milliseconds = seconds * 1000;
      if (
        !Number.isSafeInteger(seconds) ||
        seconds <= 0 ||
        !Number.isSafeInteger(milliseconds)
      ) {
        throw new Error("INVALID_ARGUMENTS");
      }
      windowMilliseconds = milliseconds;
      index += 1;
    } else if (value?.startsWith("--")) {
      throw new Error("INVALID_ARGUMENTS");
    } else if (value !== undefined) {
      paths.push(value);
    }
  }

  if (paths.length === 0) {
    throw new Error("INVALID_ARGUMENTS");
  }
  return { paths, windowMilliseconds };
}

async function run(args: readonly string[]): Promise<void> {
  const parsedArguments = parseAuditCheckArguments(args);
  const sources = await Promise.all(
    parsedArguments.paths.map(async (auditPath) => ({
      name: auditPath,
      content: await readFile(auditPath, "utf8"),
    })),
  );
  const events = sources.flatMap(({ name, content }) =>
    parseAuditJsonl(content, name),
  );
  const findings = findCrossSubjectFindings(
    events,
    parsedArguments.windowMilliseconds,
  );
  process.stdout.write(
    `${JSON.stringify({
      status: findings.length === 0 ? "clear" : "suspicious",
      heuristic: "deny then allow for the same resource from different subjects",
      windowMilliseconds: parsedArguments.windowMilliseconds,
      findingCount: findings.length,
      limitations: [
        "does not detect a privileged connection called first",
        "may flag legitimate concurrent activity",
      ],
      findings,
    }, null, 2)}\n`,
  );
  if (findings.length > 0) {
    process.exitCode = 2;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await run(process.argv.slice(2));
  } catch {
    process.stderr.write("SubjectBroker audit check failed: INVALID_INPUT\n");
    process.exitCode = 1;
  }
}
