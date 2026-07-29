#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { pathToFileURL } from "node:url";
import {
  SubjectBroker,
  DEFAULT_MAX_RESOURCE_BYTES,
  StartupConfigurationError,
} from "./broker.js";
import { createMcpServer } from "./mcp-server.js";

interface ServerArguments {
  readonly policyPath: string;
  readonly subjectId: string;
  readonly auditPath: string;
  readonly maxResourceBytes: number;
}

export type StartupArgumentErrorCode =
  | "MISSING_REQUIRED_ARGUMENT"
  | "MISSING_ARGUMENT_VALUE"
  | "INVALID_MAX_RESOURCE_BYTES"
  | "DUPLICATE_ARGUMENT"
  | "UNKNOWN_ARGUMENT";

export class StartupArgumentError extends Error {
  public readonly code: StartupArgumentErrorCode;

  public constructor(code: StartupArgumentErrorCode) {
    super(`SubjectBroker startup arguments failed: ${code}`);
    this.name = "StartupArgumentError";
    this.code = code;
  }
}

const STARTUP_FLAGS = new Set(["--policy", "--subject", "--audit", "--max-bytes"]);

function parseFlags(args: readonly string[]): ReadonlyMap<string, string> {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    if (flag === undefined || !STARTUP_FLAGS.has(flag)) {
      throw new StartupArgumentError("UNKNOWN_ARGUMENT");
    }
    if (values.has(flag)) {
      throw new StartupArgumentError("DUPLICATE_ARGUMENT");
    }
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new StartupArgumentError("MISSING_ARGUMENT_VALUE");
    }
    values.set(flag, value);
  }
  return values;
}

export function parseServerArguments(
  args: readonly string[],
  environment: NodeJS.ProcessEnv,
): ServerArguments {
  const values = parseFlags(args);
  const policyPath = values.get("--policy") ?? environment.SUBJECT_BROKER_POLICY;
  const subjectId = values.get("--subject") ?? environment.SUBJECT_BROKER_SUBJECT;
  const auditPath = values.get("--audit") ?? environment.SUBJECT_BROKER_AUDIT;
  const maximumInput =
    values.get("--max-bytes") ?? environment.SUBJECT_BROKER_MAX_RESOURCE_BYTES;

  if (!policyPath || !subjectId || !auditPath) {
    throw new StartupArgumentError("MISSING_REQUIRED_ARGUMENT");
  }
  const maxResourceBytes =
    maximumInput === undefined ? DEFAULT_MAX_RESOURCE_BYTES : Number(maximumInput);
  if (!Number.isSafeInteger(maxResourceBytes) || maxResourceBytes <= 0) {
    throw new StartupArgumentError("INVALID_MAX_RESOURCE_BYTES");
  }
  return { policyPath, subjectId, auditPath, maxResourceBytes };
}

export async function runServer(args: ServerArguments): Promise<void> {
  const broker = await SubjectBroker.create({
    policyPath: args.policyPath,
    subjectId: args.subjectId,
    auditPath: args.auditPath,
    maxResourceBytes: args.maxResourceBytes,
    failOnStartupError: true,
    onDiagnostic: (code) => {
      process.stderr.write(`SubjectBroker runtime diagnostic: ${code}\n`);
    },
  });
  const server = createMcpServer(broker);
  await server.connect(new StdioServerTransport());
}

export function startupErrorMessage(error: unknown): string {
  const code =
    error instanceof StartupConfigurationError || error instanceof StartupArgumentError
      ? error.code
      : "INVALID_STARTUP_CONFIGURATION";
  return `SubjectBroker failed to start: ${code}\n`;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await runServer(parseServerArguments(process.argv.slice(2), process.env));
  } catch (error) {
    process.stderr.write(startupErrorMessage(error));
    process.exitCode = 1;
  }
}
