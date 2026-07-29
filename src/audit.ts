import { constants } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";
import type { AuditEvent } from "./model.js";

export interface AuditWriter {
  append(event: AuditEvent): Promise<void>;
}

export type AuditFailureCode =
  | "AUDIT_DESTINATION_INVALID"
  | "AUDIT_WRITE_FAILED";

export class AuditFailureError extends Error {
  public readonly code: AuditFailureCode;

  public constructor(code: AuditFailureCode = "AUDIT_WRITE_FAILED") {
    super("Audit write failed");
    this.name = "AuditFailureError";
    this.code = code;
  }
}

export class AuditConfigurationError extends Error {
  public constructor() {
    super("Audit destination is unavailable");
    this.name = "AuditConfigurationError";
  }
}

const O_NOFOLLOW_ANY_DARWIN = 0x20000000;

function auditOpenFlags(): number {
  return (
    constants.O_WRONLY |
    constants.O_APPEND |
    (process.platform === "darwin" ? O_NOFOLLOW_ANY_DARWIN : constants.O_NOFOLLOW)
  );
}

function isAlreadyPresent(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "EEXIST";
}

async function openValidatedAudit(auditPath: string): Promise<FileHandle> {
  let handle: FileHandle | undefined;
  let created = false;
  try {
    try {
      handle = await open(
        auditPath,
        auditOpenFlags() | constants.O_CREAT | constants.O_EXCL,
        0o600,
      );
      created = true;
    } catch (error) {
      if (!isAlreadyPresent(error)) {
        throw error;
      }
      handle = await open(auditPath, auditOpenFlags());
    }
    if (created) {
      await handle.chmod(0o600);
    }
    const metadata = await handle.stat();
    if (!metadata.isFile() || (metadata.mode & 0o777) !== 0o600) {
      throw new AuditConfigurationError();
    }
    return handle;
  } catch (error) {
    await handle?.close().catch(() => undefined);
    if (error instanceof AuditConfigurationError) {
      throw error;
    }
    throw new AuditConfigurationError();
  }
}

export async function validateAuditDestination(auditPath: string): Promise<void> {
  const handle = await openValidatedAudit(auditPath);
  await handle.close();
}

export class JsonlAuditWriter implements AuditWriter {
  readonly #path: string;

  public constructor(auditPath: string) {
    this.#path = auditPath;
  }

  public async append(event: AuditEvent): Promise<void> {
    let handle: FileHandle | undefined;
    try {
      handle = await openValidatedAudit(this.#path);
      await handle.writeFile(`${JSON.stringify(event)}\n`, "utf8");
      await handle.sync();
    } catch (error) {
      throw new AuditFailureError(
        error instanceof AuditConfigurationError
          ? "AUDIT_DESTINATION_INVALID"
          : "AUDIT_WRITE_FAILED",
      );
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }
}
