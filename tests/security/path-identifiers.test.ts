import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { PROTECTED_CANARY, createFixture, type Fixture } from "../helpers/fixture.js";

let fixture: Fixture | undefined;

afterEach(async () => {
  await fixture?.cleanup();
  fixture = undefined;
});

describe("attack: path-like resource identifiers", () => {
  it.each(["../protected-storage/contract.txt", "/etc/passwd", "%2e%2e%2fcontract.txt"])(
    "denies %s without returning bytes",
    async (resourceId) => {
      fixture ??= await createFixture();
      const broker = await fixture.createBroker("allowed-agent");
      const result = await broker.readResource(resourceId);
      expect(result).toEqual({
        decision: "deny",
        reasonCode: "ACCESS_DENIED",
        resourceId,
      });
      expect(JSON.stringify(result)).not.toContain(PROTECTED_CANARY);
      expect(await readFile(fixture.auditPath, "utf8")).not.toContain(PROTECTED_CANARY);
    },
  );
});
