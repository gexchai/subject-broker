import { symlink } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RegistryError, ResourceRegistry } from "../../src/resource-registry.js";
import { createFixture, type Fixture } from "../helpers/fixture.js";

let fixture: Fixture | undefined;

afterEach(async () => {
  await fixture?.cleanup();
  fixture = undefined;
});

describe("resource registry", () => {
  it("registers an absolute file inside protected storage and opens the same identity", async () => {
    fixture = await createFixture();
    const registry = await ResourceRegistry.create(
      fixture.storageRoot,
      { protected: { path: fixture.protectedPath } },
      fixture.projectDir,
    );
    const handle = await registry.openVerified("protected");
    try {
      expect(await handle.readFile("utf8")).toContain("SUBJECT_BROKER_PROTECTED_CANARY");
    } finally {
      await handle.close();
    }
  });

  it("rejects entries outside storage and symlinks at registration", async () => {
    fixture = await createFixture();
    await expect(
      ResourceRegistry.create(
        fixture.storageRoot,
        { outside: { path: path.join(fixture.projectDir, "outside.txt") } },
        fixture.projectDir,
      ),
    ).rejects.toBeInstanceOf(RegistryError);

    const linkPath = path.join(fixture.storageRoot, "link.txt");
    await symlink(fixture.swapTargetPath, linkPath);
    await expect(
      ResourceRegistry.create(
        fixture.storageRoot,
        { linked: { path: linkPath } },
        fixture.projectDir,
      ),
    ).rejects.toBeInstanceOf(RegistryError);
  });
});
