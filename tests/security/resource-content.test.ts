import { writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { createFixture, type Fixture } from "../helpers/fixture.js";

let fixture: Fixture | undefined;

afterEach(async () => {
  await fixture?.cleanup();
  fixture = undefined;
});

describe("registered resource content constraints", () => {
  it("denies content larger than the configured byte limit", async () => {
    fixture = await createFixture();
    await writeFile(fixture.protectedPath, "123456789", "utf8");
    const broker = await fixture.createBroker("allowed-agent", { maxResourceBytes: 8 });

    await expect(broker.readResource("protected")).resolves.toEqual({
      decision: "error",
      reasonCode: "RESOURCE_TOO_LARGE",
      resourceId: "protected",
    });
  });

  it("denies content that is not valid UTF-8", async () => {
    fixture = await createFixture();
    await writeFile(fixture.protectedPath, Buffer.from([0xc3, 0x28]));
    const broker = await fixture.createBroker("allowed-agent");

    await expect(broker.readResource("protected")).resolves.toEqual({
      decision: "error",
      reasonCode: "RESOURCE_ENCODING_INVALID",
      resourceId: "protected",
    });
  });
});
