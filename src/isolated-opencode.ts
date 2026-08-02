#!/usr/bin/env node
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parsePolicy } from "./policy.js";
import {
  buildOpenCodeSubjectProfile,
  type OpenCodeAdapterArguments,
  OpenCodeAdapterError,
  parseOpenCodeAdapterArguments,
  preflightOpenCodeSubject,
  runChild,
} from "./opencode-adapter.js";
import { startSocketBroker, type SocketBrokerHandle } from "./socket-broker.js";

const SANDBOX_EXECUTABLE = "/usr/bin/sandbox-exec";

export type IsolatedOpenCodeErrorCode =
  | "HOST_ISOLATION_UNAVAILABLE"
  | "HOST_BOUNDARY_INVALID"
  | "HOST_PROFILE_FAILED"
  | "OPENCODE_PROFILE_NOT_ISOLATED"
  | "OPENCODE_EXIT_FAILED";

export class IsolatedOpenCodeError extends Error {
  public constructor(
    public readonly code: IsolatedOpenCodeErrorCode,
    cause?: unknown,
  ) {
    super(`SubjectBroker isolated OpenCode launch failed: ${code}`, { cause });
    this.name = "IsolatedOpenCodeError";
  }
}

export interface HostIsolationBoundary {
  readonly workspace: string;
  readonly trustRoot: string;
  readonly policyPath: string;
  readonly auditPath: string;
  readonly storageRoot: string;
}

function schemeString(value: string): string {
  return JSON.stringify(value);
}

function overlaps(left: string, right: string): boolean {
  const relative = path.relative(left, right);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function commonAncestor(paths: readonly string[]): string {
  const [first, ...rest] = paths.map((candidate) => path.resolve(candidate));
  if (first === undefined) {
    throw new IsolatedOpenCodeError("HOST_BOUNDARY_INVALID");
  }
  let candidate = first;
  while (!rest.every((item) => overlaps(candidate, item))) {
    const parent = path.dirname(candidate);
    if (parent === candidate) {
      return parent;
    }
    candidate = parent;
  }
  return candidate;
}

async function resolveNewFilePath(filePath: string): Promise<string> {
  const parent = await realpath(path.dirname(filePath));
  return path.join(parent, path.basename(filePath));
}

export async function resolveHostIsolationBoundary(
  args: Pick<OpenCodeAdapterArguments, "workspace" | "policyPath" | "auditPath">,
): Promise<HostIsolationBoundary> {
  try {
    const workspace = await realpath(args.workspace);
    const policyPath = await realpath(args.policyPath);
    const policy = parsePolicy(await readFile(policyPath, "utf8"));
    for (const resource of Object.values(policy.resources)) {
      if (!path.isAbsolute(resource.path)) {
        throw new IsolatedOpenCodeError("HOST_BOUNDARY_INVALID");
      }
      const resourceIdentity = await lstat(resource.path);
      if (!resourceIdentity.isFile() || resourceIdentity.nlink !== 1) {
        throw new IsolatedOpenCodeError("HOST_BOUNDARY_INVALID");
      }
    }
    const storageRoot = await realpath(policy.storageRoot);
    const auditPath = await resolveNewFilePath(args.auditPath);
    const trustRoot = commonAncestor([
      storageRoot,
      path.dirname(policyPath),
      path.dirname(auditPath),
    ]);
    if (
      trustRoot === path.parse(trustRoot).root ||
      overlaps(workspace, trustRoot) ||
      overlaps(trustRoot, workspace)
    ) {
      throw new IsolatedOpenCodeError("HOST_BOUNDARY_INVALID");
    }
    return { workspace, trustRoot, policyPath, auditPath, storageRoot };
  } catch (error) {
    if (error instanceof IsolatedOpenCodeError) {
      throw error;
    }
    throw new IsolatedOpenCodeError("HOST_BOUNDARY_INVALID");
  }
}

export function buildMacOSSandboxProfile(
  boundary: HostIsolationBoundary,
  profilePath?: string,
  capabilityDirectory?: string,
): string {
  const protectedFiles = [profilePath].filter(
    (value): value is string => value !== undefined,
  );
  const rules = [
    "(version 1)",
    "(allow default)",
    `(deny file-read* (subpath ${schemeString(boundary.trustRoot)}))`,
    `(deny file-write* (subpath ${schemeString(boundary.trustRoot)}))`,
    ...(capabilityDirectory === undefined
      ? []
      : [`(deny file-write* (subpath ${schemeString(capabilityDirectory)}))`]),
    ...protectedFiles.flatMap((filePath) => [
      `(deny file-read* (literal ${schemeString(filePath)}))`,
      `(deny file-write* (literal ${schemeString(filePath)}))`,
    ]),
  ];
  return `${rules.join("\n")}\n`;
}

function scrubBrokerStartupEnvironment(
  environment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(environment).filter(([key]) => !key.startsWith("SUBJECT_BROKER_")),
  );
}

async function assertHostMechanism(): Promise<void> {
  if (process.platform !== "darwin") {
    throw new IsolatedOpenCodeError("HOST_ISOLATION_UNAVAILABLE");
  }
  try {
    const executable = await stat(SANDBOX_EXECUTABLE);
    if (!executable.isFile()) {
      throw new Error("sandbox-exec is unavailable");
    }
  } catch {
    throw new IsolatedOpenCodeError("HOST_ISOLATION_UNAVAILABLE");
  }
}

export async function runIsolatedOpenCodeSubject(
  args: OpenCodeAdapterArguments,
): Promise<number> {
  await assertHostMechanism();
  const boundary = await resolveHostIsolationBoundary(args);
  // Darwin limits Unix-domain socket path length. Keep this trusted, mode-0700
  // runtime path short enough for the kernel even when TMPDIR is deeply nested.
  const temporaryParent = process.platform === "darwin" ? "/tmp" : os.tmpdir();
  const temporaryRoot = await mkdtemp(path.join(temporaryParent, "sb-iso-"));
  let brokerHandle: SocketBrokerHandle | undefined;
  try {
    const configHome = path.join(temporaryRoot, "config");
    const capabilityDirectory = path.join(temporaryRoot, "capability");
    const socketPath = path.join(capabilityDirectory, "subject-broker.sock");
    const profilePath = path.join(temporaryRoot, "agent.sb");
    await mkdir(configHome, { mode: 0o700 });
    await mkdir(capabilityDirectory, { mode: 0o700 });

    brokerHandle = await startSocketBroker(
      {
        policyPath: boundary.policyPath,
        subjectId: args.subjectId,
        auditPath: boundary.auditPath,
        maxResourceBytes: 1024 * 1024,
        failOnStartupError: true,
      },
      args.serverName,
      socketPath,
    );

    const relayExecutable = fileURLToPath(new URL("socket-relay.js", import.meta.url));
    const profile = buildOpenCodeSubjectProfile(
      args,
      relayExecutable,
      [process.execPath, relayExecutable, "--socket", socketPath],
    );
    const environment = await preflightOpenCodeSubject(
      args,
      profile,
      configHome,
      scrubBrokerStartupEnvironment(process.env),
    );
    await writeFile(
      profilePath,
      buildMacOSSandboxProfile(boundary, profilePath, capabilityDirectory),
      { mode: 0o600 },
    );

    const exitCode = await runChild(
      SANDBOX_EXECUTABLE,
      ["-f", profilePath, args.opencodeExecutable, "--pure", ...args.opencodeArguments],
      { cwd: boundary.workspace, env: environment },
    );
    if (exitCode !== 0) {
      throw new IsolatedOpenCodeError("OPENCODE_EXIT_FAILED");
    }
    return exitCode;
  } catch (error) {
    if (error instanceof IsolatedOpenCodeError) {
      throw error;
    }
    if (error instanceof OpenCodeAdapterError) {
      throw new IsolatedOpenCodeError(
        error.code === "OPENCODE_PROFILE_NOT_ISOLATED"
          ? "OPENCODE_PROFILE_NOT_ISOLATED"
          : "HOST_PROFILE_FAILED",
      );
    }
    throw new IsolatedOpenCodeError("HOST_PROFILE_FAILED", error);
  } finally {
    await brokerHandle?.close();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function runCli(): Promise<void> {
  try {
    const args = parseOpenCodeAdapterArguments(process.argv.slice(2));
    await runIsolatedOpenCodeSubject(args);
  } catch (error) {
    const code =
      error instanceof IsolatedOpenCodeError
        ? error.code
        : "HOST_PROFILE_FAILED";
    process.stderr.write(`SubjectBroker isolated OpenCode launch failed: ${code}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runCli();
}
