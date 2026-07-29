import { describe, expect, it } from "vitest";
import {
  findCrossSubjectFindings,
  parseAuditCheckArguments,
  parseAuditJsonl,
} from "../../src/audit-check.js";

const denial =
  '{"timestamp":"2026-07-28T08:06:17.818Z","subjectId":"worker","resourceId":"secret","action":"read","decision":"deny","reasonCode":"ACCESS_DENIED"}';
const allow =
  '{"timestamp":"2026-07-28T08:06:20.158Z","subjectId":"orchestrator","resourceId":"secret","action":"read","decision":"allow","reasonCode":"ALLOWED"}';

describe("cross-subject audit anomaly checker", () => {
  it("flags the FE-01 deny-then-allow sequence", () => {
    const events = parseAuditJsonl(`${denial}\n${allow}\n`, "audit.jsonl");

    expect(findCrossSubjectFindings(events, 10_000)).toEqual([
      {
        kind: "CROSS_SUBJECT_DENY_THEN_ALLOW",
        resourceId: "secret",
        elapsedMilliseconds: 2340,
        denied: {
          timestamp: "2026-07-28T08:06:17.818Z",
          subjectId: "worker",
          source: "audit.jsonl",
          line: 1,
        },
        allowed: {
          timestamp: "2026-07-28T08:06:20.158Z",
          subjectId: "orchestrator",
          source: "audit.jsonl",
          line: 2,
        },
      },
    ]);
  });

  it("does not flag the same subject, a late allow, or an allow with no prior denial", () => {
    const sameSubjectAllow = allow.replace("orchestrator", "worker");
    const lateAllow = allow.replace("08:06:20.158", "08:07:20.158");

    expect(
      findCrossSubjectFindings(
        parseAuditJsonl(`${denial}\n${sameSubjectAllow}\n`, "same.jsonl"),
        10_000,
      ),
    ).toEqual([]);
    expect(
      findCrossSubjectFindings(
        parseAuditJsonl(`${denial}\n${lateAllow}\n`, "late.jsonl"),
        10_000,
      ),
    ).toEqual([]);
    expect(
      findCrossSubjectFindings(parseAuditJsonl(`${allow}\n`, "allow.jsonl"), 10_000),
    ).toEqual([]);
  });

  it("combines and time-orders events from separate audit files", () => {
    const allowedEvents = parseAuditJsonl(`${allow}\n`, "orchestrator.jsonl");
    const deniedEvents = parseAuditJsonl(`${denial}\n`, "worker.jsonl");

    expect(
      findCrossSubjectFindings([...allowedEvents, ...deniedEvents], 10_000),
    ).toHaveLength(1);
  });

  it("rejects malformed or schema-incompatible audit lines", () => {
    expect(() => parseAuditJsonl("{not-json}\n", "bad.jsonl")).toThrow(
      "INVALID_AUDIT_INPUT",
    );
    expect(() =>
      parseAuditJsonl(
        '{"timestamp":"not-a-time","subjectId":"worker"}\n',
        "bad.jsonl",
      ),
    ).toThrow("INVALID_AUDIT_INPUT");
  });

  it("parses a configurable positive time window and one or more paths", () => {
    expect(
      parseAuditCheckArguments([
        "--window-seconds",
        "30",
        "worker.jsonl",
        "orchestrator.jsonl",
      ]),
    ).toEqual({
      paths: ["worker.jsonl", "orchestrator.jsonl"],
      windowMilliseconds: 30_000,
    });
    expect(() => parseAuditCheckArguments([])).toThrow("INVALID_ARGUMENTS");
    expect(() =>
      parseAuditCheckArguments(["--window-seconds", "0", "audit.jsonl"]),
    ).toThrow("INVALID_ARGUMENTS");
  });
});
