import { describe, expect, it } from "vitest";
import { stringify } from "yaml";
import { evaluate, parsePolicy, PolicyLoadError } from "../../src/policy.js";

const validPolicy = {
  version: 1,
  storageRoot: "/private/tmp/subject-broker-storage",
  subjects: ["allowed", "denied"],
  resources: { contract: { path: "/private/tmp/subject-broker-storage/contract.txt" } },
  rules: [
    { subject: "allowed", resource: "contract", action: "read", decision: "allow" },
    { subject: "denied", resource: "contract", action: "read", decision: "deny" },
  ],
};

describe("policy parsing and evaluation", () => {
  it("allows only an explicit matching allow rule", () => {
    const policy = parsePolicy(stringify(validPolicy));
    expect(evaluate(policy, true, "allowed", "contract", "read")).toEqual({
      decision: "allow",
      reasonCode: "ALLOWED",
    });
  });

  it("does not reveal whether a resource is forbidden or unknown", () => {
    const policy = parsePolicy(stringify(validPolicy));
    const forbidden = evaluate(policy, true, "denied", "contract", "read");
    const unknown = evaluate(policy, true, "denied", "does-not-exist", "read");
    expect(forbidden).toEqual({ decision: "deny", reasonCode: "ACCESS_DENIED" });
    expect(unknown).toEqual(forbidden);
  });

  it.each([
    ["unknown top-level field", { ...validPolicy, surprise: true }],
    ["unknown schema version", { ...validPolicy, version: 2 }],
    [
      "unknown rule subject",
      {
        ...validPolicy,
        rules: [{ subject: "other", resource: "contract", action: "read", decision: "allow" }],
      },
    ],
  ])("rejects %s", (_name, input) => {
    expect(() => parsePolicy(stringify(input))).toThrow(PolicyLoadError);
  });

  it("rejects duplicate YAML keys and duplicate rules", () => {
    expect(() =>
      parsePolicy("version: 1\nversion: 1\nstorageRoot: /tmp\nsubjects: [a]\nresources: {}\nrules: []\n"),
    ).toThrow(PolicyLoadError);
    expect(() =>
      parsePolicy(
        stringify({
          ...validPolicy,
          rules: [validPolicy.rules[0], validPolicy.rules[0]],
        }),
      ),
    ).toThrow(PolicyLoadError);
  });
});
