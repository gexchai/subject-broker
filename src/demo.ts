#!/usr/bin/env node
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { stringify } from "yaml";
import { SubjectBroker } from "./broker.js";

const CANARY = "SUBJECT_BROKER_DEMO_SECRET";

async function runDemo(): Promise<void> {
  if (process.platform !== "darwin") {
    throw new Error("The current hard-enforcement demo requires macOS.");
  }

  const temporaryRoot = await realpath(os.tmpdir());
  const root = await mkdtemp(path.join(temporaryRoot, "subject-broker-demo-"));
  const storageRoot = path.join(root, "protected-storage");
  const secretPath = path.join(storageRoot, "secret.txt");
  const policyPath = path.join(root, "subject-broker.yaml");
  const orchestratorAudit = path.join(root, "audit-orchestrator.jsonl");
  const workerAudit = path.join(root, "audit-worker.jsonl");

  try {
    await mkdir(storageRoot, { mode: 0o700 });
    await chmod(storageRoot, 0o700);
    await writeFile(secretPath, `${CANARY}\n`, { mode: 0o600 });
    await writeFile(
      policyPath,
      stringify({
        version: 1,
        storageRoot,
        subjects: ["orchestrator", "worker"],
        resources: {
          secret: { path: secretPath },
        },
        rules: [
          {
            subject: "orchestrator",
            resource: "secret",
            action: "read",
            decision: "allow",
          },
          {
            subject: "worker",
            resource: "secret",
            action: "read",
            decision: "deny",
          },
        ],
      }),
      "utf8",
    );

    const orchestrator = await SubjectBroker.create({
      policyPath,
      subjectId: "orchestrator",
      auditPath: orchestratorAudit,
      failOnStartupError: true,
    });
    const worker = await SubjectBroker.create({
      policyPath,
      subjectId: "worker",
      auditPath: workerAudit,
      failOnStartupError: true,
    });

    const allowed = await orchestrator.readResource("secret");
    const denied = await worker.readResource("secret");

    process.stdout.write("SubjectBroker subject-bound read demo\n\n");
    process.stdout.write(`orchestrator → ${JSON.stringify(allowed)}\n`);
    process.stdout.write(`worker       → ${JSON.stringify(denied)}\n\n`);
    process.stdout.write("Both outcomes were written to separate metadata-only audit logs.\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

try {
  await runDemo();
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown demo failure";
  process.stderr.write(`SubjectBroker demo failed: ${message}\n`);
  process.exitCode = 1;
}
