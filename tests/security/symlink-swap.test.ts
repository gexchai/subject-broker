import { readFile, rename, rm, symlink } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { SWAP_CANARY, createFixture, type Fixture } from "../helpers/fixture.js";

let fixture: Fixture | undefined;

afterEach(async () => {
  await fixture?.cleanup();
  fixture = undefined;
});

describe("attack: symlink swap", () => {
  it("denies when a registered file is replaced by a symlink", async () => {
    fixture = await createFixture();
    const broker = await fixture.createBroker("allowed-agent");
    await rm(fixture.protectedPath);
    await symlink(fixture.swapTargetPath, fixture.protectedPath);

    const result = await broker.readResource("protected");
    expect(result).toEqual({
      decision: "error",
      reasonCode: "RESOURCE_CHANGED",
      resourceId: "protected",
    });
    const outputs = `${JSON.stringify(result)}\n${await readFile(fixture.auditPath, "utf8")}`;
    expect(outputs).not.toContain(SWAP_CANARY);
  });

  it.runIf(process.platform === "darwin")(
    "denies when a registered ancestor is replaced by a symlink to the same file identity",
    async () => {
      fixture = await createFixture();
      const broker = await fixture.createBroker("allowed-agent");
      const movedStorage = `${fixture.storageRoot}-moved`;
      await rename(fixture.storageRoot, movedStorage);
      await symlink(movedStorage, fixture.storageRoot, "dir");

      const result = await broker.readResource("protected");

      expect(result).toEqual({
        decision: "error",
        reasonCode: "RESOURCE_CHANGED",
        resourceId: "protected",
      });
    },
  );
});
