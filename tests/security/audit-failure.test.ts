import { afterEach, describe, expect, it } from "vitest";
import { AuditFailureError, type AuditWriter } from "../../src/audit.js";
import { createFixture, PROTECTED_CANARY, type Fixture } from "../helpers/fixture.js";

let fixture: Fixture | undefined;

afterEach(async () => {
  await fixture?.cleanup();
  fixture = undefined;
});

describe("attack: audit sink failure", () => {
  it("blocks an otherwise allowed read", async () => {
    fixture = await createFixture();
    const diagnostics: string[] = [];
    const failingAudit: AuditWriter = {
      append: async () => {
        throw new AuditFailureError();
      },
    };
    const broker = await fixture.createBroker("allowed-agent", {
      auditWriter: failingAudit,
      onDiagnostic: (code) => {
        diagnostics.push(code);
      },
    });
    const result = await broker.readResource("protected");
    expect(result).toEqual({
      decision: "error",
      reasonCode: "AUDIT_FAILED",
      resourceId: "protected",
    });
    expect(JSON.stringify(result)).not.toContain(PROTECTED_CANARY);
    expect(diagnostics).toEqual(["AUDIT_WRITE_FAILED"]);
  });
});
