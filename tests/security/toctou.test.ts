import { readFile, rename, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { createFixture, SWAP_CANARY, type Fixture } from "../helpers/fixture.js";

let fixture: Fixture | undefined;

afterEach(async () => {
  await fixture?.cleanup();
  fixture = undefined;
});

describe("attack: replacement between evaluation and read", () => {
  it("detects a new inode and denies rather than serving it", async () => {
    fixture = await createFixture();
    const broker = await fixture.createBroker("allowed-agent", {
      hooks: {
        beforeResourceOpen: async () => {
          await rename(fixture!.protectedPath, `${fixture!.protectedPath}.old`);
          await writeFile(fixture!.protectedPath, SWAP_CANARY, { mode: 0o600 });
        },
      },
    });

    const result = await broker.readResource("protected");
    expect(result).toEqual({
      decision: "error",
      reasonCode: "RESOURCE_CHANGED",
      resourceId: "protected",
    });
    const outputs = `${JSON.stringify(result)}\n${await readFile(fixture.auditPath, "utf8")}`;
    expect(outputs).not.toContain(SWAP_CANARY);
  });

  it("requires a new broker process after an owner atomic save", async () => {
    fixture = await createFixture();
    const broker = await fixture.createBroker("allowed-agent");
    const temporaryPath = `${fixture.protectedPath}.save`;
    await writeFile(temporaryPath, "updated owner content", { mode: 0o600 });
    await rename(temporaryPath, fixture.protectedPath);

    await expect(broker.readResource("protected")).resolves.toEqual({
      decision: "error",
      reasonCode: "RESOURCE_CHANGED",
      resourceId: "protected",
    });

    const restarted = await fixture.createBroker("allowed-agent");
    await expect(restarted.readResource("protected")).resolves.toMatchObject({
      decision: "allow",
      reasonCode: "ALLOWED",
      resourceId: "protected",
      content: "updated owner content",
    });
  });
});
