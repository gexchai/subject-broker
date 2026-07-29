import { afterEach, describe, expect, it } from "vitest";
import type { AuditEvent } from "../../src/model.js";
import type { AuditWriter } from "../../src/audit.js";
import { createFixture, type Fixture } from "../helpers/fixture.js";

let fixture: Fixture | undefined;

afterEach(async () => {
  await fixture?.cleanup();
  fixture = undefined;
});

describe("read audit contract", () => {
  it.each([
    { subject: "allowed-agent", expected: "allow" },
    { subject: "denied-agent", expected: "deny" },
  ] as const)("appends exactly one event for a $expected read", async ({ subject, expected }) => {
    fixture = await createFixture();
    const events: AuditEvent[] = [];
    const auditWriter: AuditWriter = {
      append: async (event) => {
        events.push(event);
      },
    };
    const broker = await fixture.createBroker(subject, { auditWriter });

    const result = await broker.readResource("protected");

    expect(result.decision).toBe(expected);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      subjectId: subject,
      resourceId: "protected",
      action: "read",
      decision: expected,
    });
  });

  it("appends exactly one event for an errored read", async () => {
    fixture = await createFixture();
    const events: AuditEvent[] = [];
    const auditWriter: AuditWriter = {
      append: async (event) => {
        events.push(event);
      },
    };
    const broker = await fixture.createBroker("allowed-agent", {
      auditWriter,
      hooks: {
        beforeResourceOpen: async () => {
          throw new Error("synthetic internal failure");
        },
      },
    });

    await expect(broker.readResource("protected")).resolves.toMatchObject({
      decision: "error",
      reasonCode: "INTERNAL_ERROR",
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: "read",
      decision: "error",
      reasonCode: "INTERNAL_ERROR",
    });
  });
});
