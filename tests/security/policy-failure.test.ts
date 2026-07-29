import { writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stringify } from "yaml";
import { SubjectBroker } from "../../src/broker.js";
import { createFixture, PROTECTED_CANARY, type Fixture } from "../helpers/fixture.js";

let fixture: Fixture | undefined;

afterEach(async () => {
  await fixture?.cleanup();
  fixture = undefined;
});

describe("attack: unavailable policy", () => {
  it.each(["missing", "corrupt", "unknown-schema"] as const)(
    "denies every read for a %s policy without bytes",
    async (kind) => {
      fixture = await createFixture();
      let policyPath = fixture.policyPath;
      if (kind === "missing") {
        policyPath = path.join(fixture.projectDir, "missing.yaml");
      } else if (kind === "corrupt") {
        await writeFile(policyPath, "version: [\nprotected-bytes: " + PROTECTED_CANARY, "utf8");
      } else {
        await writeFile(
          policyPath,
          stringify({
            version: 99,
            storageRoot: fixture.storageRoot,
            subjects: ["allowed-agent"],
            resources: { protected: { path: fixture.protectedPath } },
            rules: [],
          }),
          "utf8",
        );
      }

      const broker = await SubjectBroker.create({
        policyPath,
        subjectId: "allowed-agent",
        auditPath: fixture.auditPath,
        workingDirectory: fixture.projectDir,
        platform: "darwin",
      });
      for (const resourceId of ["protected", "../contract.txt"]) {
        const result = await broker.readResource(resourceId);
        expect(result).toEqual({
          decision: "deny",
          reasonCode: "POLICY_UNAVAILABLE",
          resourceId,
        });
        expect(JSON.stringify(result)).not.toContain(PROTECTED_CANARY);
      }
    },
  );
});
