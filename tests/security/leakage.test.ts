import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFixture, PROTECTED_CANARY, type Fixture } from "../helpers/fixture.js";

let fixture: Fixture | undefined;

afterEach(async () => {
  vi.restoreAllMocks();
  await fixture?.cleanup();
  fixture = undefined;
});

describe("attack: denial and error-channel leakage", () => {
  it("keeps the canary out of responses, explanations, stacks, stderr, and audit", async () => {
    fixture = await createFixture();
    const stderr: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation(((chunk: string | Uint8Array) => {
      stderr.push(String(chunk));
      return true;
    }) as typeof process.stderr.write);

    const deniedBroker = await fixture.createBroker("denied-agent");
    const denied = await deniedBroker.readResource("protected");
    const explanation = deniedBroker.explain("protected", "read");

    const errorBroker = await fixture.createBroker("allowed-agent", {
      hooks: {
        beforeResourceOpen: async () => {
          throw new Error(`internal failure near ${PROTECTED_CANARY}`);
        },
      },
    });
    const error = await errorBroker.readResource("protected");
    const audit = await readFile(fixture.auditPath, "utf8");
    const everyOutput = JSON.stringify({ denied, explanation, error, stderr, audit });

    expect(denied).not.toHaveProperty("content");
    expect(error).not.toHaveProperty("content");
    expect(everyOutput).not.toContain(PROTECTED_CANARY);
    expect(everyOutput).not.toMatch(/\bat\s+\S+\s+\([^)\n]+:\d+:\d+\)/u);
    expect(everyOutput).not.toContain(fixture.root);
    expect(audit).not.toContain(fixture.protectedPath);
  });
});
