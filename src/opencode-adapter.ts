#!/usr/bin/env node
import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const identifier = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;

export type OpenCodeAdapterErrorCode =
  | "INVALID_ARGUMENTS"
  | "WORKSPACE_UNAVAILABLE"
  | "OPENCODE_EXECUTABLE_UNAVAILABLE"
  | "OPENCODE_PROFILE_NOT_ISOLATED"
  | "OPENCODE_EXIT_FAILED";

export class OpenCodeAdapterError extends Error {
  public readonly code: OpenCodeAdapterErrorCode;

  public constructor(code: OpenCodeAdapterErrorCode) {
    super(`OpenCode adapter failed: ${code}`);
    this.name = "OpenCodeAdapterError";
    this.code = code;
  }
}

export interface OpenCodeAdapterArguments {
  readonly subjectId: string;
  readonly policyPath: string;
  readonly auditPath: string;
  readonly workspace: string;
  readonly opencodeExecutable: string;
  readonly serverName: string;
  readonly opencodeArguments: readonly string[];
}

export interface OpenCodeSubjectProfile {
  readonly $schema: string;
  readonly share: "disabled";
  readonly plugin: readonly [];
  readonly default_agent: "subject-session";
  readonly permission: Readonly<Record<string, "allow" | "deny">>;
  readonly mcp: Readonly<
    Record<
      string,
      {
        readonly type: "local";
        readonly command: readonly string[];
        readonly enabled: true;
        readonly timeout: number;
      }
    >
  >;
  readonly agent: {
    readonly "subject-session": {
      readonly description: string;
      readonly mode: "primary";
      readonly prompt: string;
      readonly permission: Readonly<Record<string, "allow" | "deny">>;
    };
  };
}

const flags = new Set([
  "--subject",
  "--policy",
  "--audit",
  "--workspace",
  "--opencode",
  "--server-name",
]);

function defaultServerName(subjectId: string): string {
  const words = subjectId.split(/[._-]+/u).filter((word) => word.length > 0);
  const suffix = words
    .map((word) => `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`)
    .join("");
  return `sb${suffix}`;
}

export function parseOpenCodeAdapterArguments(
  args: readonly string[],
  workingDirectory = process.cwd(),
): OpenCodeAdapterArguments {
  const separator = args.indexOf("--");
  const adapterArguments = separator === -1 ? args : args.slice(0, separator);
  const opencodeArguments = separator === -1 ? [] : args.slice(separator + 1);
  const values = new Map<string, string>();

  for (let index = 0; index < adapterArguments.length; index += 2) {
    const flag = adapterArguments[index];
    const value = adapterArguments[index + 1];
    if (
      flag === undefined ||
      value === undefined ||
      !flags.has(flag) ||
      value.startsWith("--") ||
      values.has(flag)
    ) {
      throw new OpenCodeAdapterError("INVALID_ARGUMENTS");
    }
    values.set(flag, value);
  }

  const subjectId = values.get("--subject");
  const policyInput = values.get("--policy");
  const auditInput = values.get("--audit");
  const workspaceInput = values.get("--workspace");
  if (
    subjectId === undefined ||
    policyInput === undefined ||
    auditInput === undefined ||
    workspaceInput === undefined ||
    !identifier.test(subjectId)
  ) {
    throw new OpenCodeAdapterError("INVALID_ARGUMENTS");
  }

  const serverName = values.get("--server-name") ?? defaultServerName(subjectId);
  if (!identifier.test(serverName)) {
    throw new OpenCodeAdapterError("INVALID_ARGUMENTS");
  }

  return {
    subjectId,
    policyPath: path.resolve(workingDirectory, policyInput),
    auditPath: path.resolve(workingDirectory, auditInput),
    workspace: path.resolve(workingDirectory, workspaceInput),
    opencodeExecutable: values.get("--opencode") ?? "opencode",
    serverName,
    opencodeArguments,
  };
}

export function buildOpenCodeSubjectProfile(
  args: Pick<
    OpenCodeAdapterArguments,
    "subjectId" | "policyPath" | "auditPath" | "serverName"
  >,
  serverExecutable = fileURLToPath(new URL("server.js", import.meta.url)),
): OpenCodeSubjectProfile {
  const toolPermission = {
    "*": "deny" as const,
    [`${args.serverName}_list_resources`]: "allow" as const,
    [`${args.serverName}_read_resource`]: "allow" as const,
    [`${args.serverName}_explain_decision`]: "allow" as const,
    [`${args.serverName}_capability_report`]: "allow" as const,
  };
  return {
    $schema: "https://opencode.ai/config.json",
    share: "disabled",
    plugin: [],
    default_agent: "subject-session",
    permission: toolPermission,
    mcp: {
      [args.serverName]: {
        type: "local",
        command: [
          process.execPath,
          serverExecutable,
          "--policy",
          args.policyPath,
          "--subject",
          args.subjectId,
          "--audit",
          args.auditPath,
          "--server-name",
          args.serverName,
          "--max-bytes",
          "1048576",
        ],
        enabled: true,
        timeout: 10000,
      },
    },
    agent: {
      "subject-session": {
        description: `Single-subject SubjectBroker session bound to ${args.subjectId}.`,
        mode: "primary",
        prompt:
          `This process is bound to SubjectBroker subject "${args.subjectId}". ` +
          "Use only the assigned SubjectBroker connection and report denials exactly.",
        permission: toolPermission,
      },
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function sameStringRecord(
  actual: unknown,
  expected: Readonly<Record<string, string>>,
): boolean {
  const record = asRecord(actual);
  if (record === undefined) {
    return false;
  }
  const actualKeys = Object.keys(record).sort();
  const expectedKeys = Object.keys(expected).sort();
  return (
    JSON.stringify(actualKeys) === JSON.stringify(expectedKeys) &&
    expectedKeys.every((key) => record[key] === expected[key])
  );
}

export function resolvedProfileIsIsolated(
  value: unknown,
  expected: OpenCodeSubjectProfile,
): boolean {
  const resolved = asRecord(value);
  const resolvedMcp = asRecord(resolved?.mcp);
  const expectedServerName = Object.keys(expected.mcp)[0];
  if (expectedServerName === undefined || resolvedMcp === undefined) {
    return false;
  }
  const keys = Object.keys(resolvedMcp);
  if (keys.length !== 1 || keys[0] !== expectedServerName) {
    return false;
  }
  const resolvedServer = asRecord(resolvedMcp[expectedServerName]);
  const expectedServer = expected.mcp[expectedServerName];
  const resolvedAgents = asRecord(resolved?.agent);
  const resolvedSubjectAgent = asRecord(resolvedAgents?.["subject-session"]);
  return (
    resolved?.share === "disabled" &&
    resolved.default_agent === "subject-session" &&
    sameStringRecord(resolved.permission, expected.permission) &&
    sameStringRecord(
      resolvedSubjectAgent?.permission,
      expected.agent["subject-session"].permission,
    ) &&
    Array.isArray(resolved.plugin) &&
    resolved.plugin.length === 0 &&
    resolvedServer?.type === "local" &&
    resolvedServer.enabled === true &&
    Array.isArray(resolvedServer.command) &&
    JSON.stringify(resolvedServer.command) === JSON.stringify(expectedServer?.command)
  );
}

async function assertWorkspace(workspace: string): Promise<void> {
  try {
    if (!(await stat(workspace)).isDirectory()) {
      throw new OpenCodeAdapterError("WORKSPACE_UNAVAILABLE");
    }
  } catch (error) {
    if (error instanceof OpenCodeAdapterError) {
      throw error;
    }
    throw new OpenCodeAdapterError("WORKSPACE_UNAVAILABLE");
  }
}

async function runChild(
  executable: string,
  args: readonly string[],
  options: { readonly cwd: string; readonly env: NodeJS.ProcessEnv },
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: "inherit",
    });
    child.once("error", () =>
      reject(new OpenCodeAdapterError("OPENCODE_EXECUTABLE_UNAVAILABLE")),
    );
    child.once("exit", (code, signal) => {
      resolve(code ?? (signal === null ? 1 : 128));
    });
  });
}

export async function runOpenCodeSubject(
  args: OpenCodeAdapterArguments,
): Promise<number> {
  await assertWorkspace(args.workspace);
  const temporaryRoot = await mkdtemp(
    path.join(os.tmpdir(), "subject-broker-opencode-profile-"),
  );
  try {
    const configHome = path.join(temporaryRoot, "config");
    await mkdir(configHome, { mode: 0o700 });
    const profile = buildOpenCodeSubjectProfile(args);
    const environment: NodeJS.ProcessEnv = {
      ...process.env,
      XDG_CONFIG_HOME: configHome,
      OPENCODE_CONFIG_CONTENT: JSON.stringify(profile),
    };
    let stdout: string;
    try {
      ({ stdout } = await execFileAsync(
        args.opencodeExecutable,
        ["debug", "config", "--pure"],
        { cwd: args.workspace, env: environment, encoding: "utf8" },
      ));
    } catch (error) {
      throw new OpenCodeAdapterError(
        (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT"
          ? "OPENCODE_EXECUTABLE_UNAVAILABLE"
          : "OPENCODE_PROFILE_NOT_ISOLATED",
      );
    }
    let resolved: unknown;
    try {
      resolved = JSON.parse(stdout);
    } catch {
      throw new OpenCodeAdapterError("OPENCODE_PROFILE_NOT_ISOLATED");
    }
    if (!resolvedProfileIsIsolated(resolved, profile)) {
      throw new OpenCodeAdapterError("OPENCODE_PROFILE_NOT_ISOLATED");
    }

    const exitCode = await runChild(
      args.opencodeExecutable,
      ["--pure", ...args.opencodeArguments],
      { cwd: args.workspace, env: environment },
    );
    if (exitCode !== 0) {
      throw new OpenCodeAdapterError("OPENCODE_EXIT_FAILED");
    }
    return exitCode;
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function runCli(): Promise<void> {
  try {
    const args = parseOpenCodeAdapterArguments(process.argv.slice(2));
    await runOpenCodeSubject(args);
  } catch (error) {
    const code = error instanceof OpenCodeAdapterError ? error.code : "INVALID_ARGUMENTS";
    process.stderr.write(`SubjectBroker OpenCode adapter failed: ${code}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runCli();
}
