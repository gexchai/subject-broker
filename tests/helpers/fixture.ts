import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { stringify } from "yaml";
import { SubjectBroker, type BrokerHooks } from "../../src/broker.js";
import type { AuditWriter } from "../../src/audit.js";
import type { AuditFailureCode } from "../../src/audit.js";

export const PROTECTED_CANARY = "SUBJECT_BROKER_PROTECTED_CANARY_7f3e9a";
export const SWAP_CANARY = "SUBJECT_BROKER_SWAP_CANARY_81c6d4";

export interface Fixture {
  readonly root: string;
  readonly projectDir: string;
  readonly storageRoot: string;
  readonly protectedPath: string;
  readonly swapTargetPath: string;
  readonly policyPath: string;
  readonly auditPath: string;
  cleanup(): Promise<void>;
  createBroker(
    subjectId: string,
    options?: {
      auditWriter?: AuditWriter;
      hooks?: BrokerHooks;
      maxResourceBytes?: number;
      onDiagnostic?: (code: AuditFailureCode) => void;
    },
  ): Promise<SubjectBroker>;
}

export interface FixturePolicy {
  readonly version: number;
  readonly storageRoot: string;
  readonly subjects: readonly string[];
  readonly resources: Readonly<Record<string, { readonly path: string }>>;
  readonly rules: readonly {
    readonly subject: string;
    readonly resource: string;
    readonly action: string;
    readonly decision: string;
  }[];
}

export async function createFixture(): Promise<Fixture> {
  const temporaryRoot = await realpath(os.tmpdir());
  const root = await mkdtemp(path.join(temporaryRoot, "subject-broker-test-"));
  const projectDir = path.join(root, "project");
  const storageRoot = path.join(root, "protected-storage");
  const protectedPath = path.join(storageRoot, "contract.txt");
  const swapTargetPath = path.join(storageRoot, "swap-target.txt");
  const policyPath = path.join(projectDir, "subject-broker.yaml");
  const auditPath = path.join(root, "audit.jsonl");

  await mkdir(projectDir);
  await mkdir(storageRoot, { mode: 0o700 });
  await chmod(storageRoot, 0o700);
  await writeFile(protectedPath, PROTECTED_CANARY, { mode: 0o600 });
  await writeFile(swapTargetPath, SWAP_CANARY, { mode: 0o600 });

  const policy: FixturePolicy = {
    version: 1,
    storageRoot,
    subjects: ["allowed-agent", "denied-agent"],
    resources: {
      protected: { path: protectedPath },
    },
    rules: [
      {
        subject: "allowed-agent",
        resource: "protected",
        action: "read",
        decision: "allow",
      },
      {
        subject: "denied-agent",
        resource: "protected",
        action: "read",
        decision: "deny",
      },
    ],
  };
  await writeFile(policyPath, stringify(policy), "utf8");

  return {
    root,
    projectDir,
    storageRoot,
    protectedPath,
    swapTargetPath,
    policyPath,
    auditPath,
    cleanup: async () => rm(root, { recursive: true, force: true }),
    createBroker: async (subjectId, options = {}) =>
      SubjectBroker.create({
        policyPath,
        subjectId,
        auditPath,
        workingDirectory: projectDir,
        platform: "darwin",
        auditWriter: options.auditWriter,
        hooks: options.hooks,
        maxResourceBytes: options.maxResourceBytes,
        onDiagnostic: options.onDiagnostic,
        now: () => new Date("2026-07-27T00:00:00.000Z"),
      }),
  };
}
