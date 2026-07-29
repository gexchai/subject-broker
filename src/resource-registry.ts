import { constants } from "node:fs";
import { lstat, open, type FileHandle, stat } from "node:fs/promises";
import path from "node:path";
import type { ResourceDefinition } from "./model.js";

// macOS defines O_NOFOLLOW_ANY, but Node.js does not currently expose it.
const O_NOFOLLOW_ANY_DARWIN = 0x20000000;

function readOnlyNoSymlinksFlags(): number {
  return (
    constants.O_RDONLY |
    (process.platform === "darwin" ? O_NOFOLLOW_ANY_DARWIN : constants.O_NOFOLLOW)
  );
}

interface RegisteredResource {
  readonly id: string;
  readonly absolutePath: string;
  readonly device: number;
  readonly inode: number;
}

export type RegistryErrorCode =
  | "STORAGE_MODE_INVALID"
  | "PATH_CONTAINS_SYMLINK"
  | "RESOURCE_MISSING"
  | "RESOURCE_CONFIGURATION_INVALID";

export class RegistryError extends Error {
  public readonly code: RegistryErrorCode;

  public constructor(code: RegistryErrorCode = "RESOURCE_CONFIGURATION_INVALID") {
    super("Resource registry is unavailable");
    this.name = "RegistryError";
    this.code = code;
  }
}

export class ResourceChangedError extends Error {
  public constructor() {
    super("Registered resource identity changed");
    this.name = "ResourceChangedError";
  }
}

function missingOrInvalid(error: unknown): RegistryError {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return new RegistryError(
    code === "ENOENT" || code === "ENOTDIR"
      ? "RESOURCE_MISSING"
      : "RESOURCE_CONFIGURATION_INVALID",
  );
}

function isInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}

async function assertNoSymlink(absolutePath: string): Promise<void> {
  const parsed = path.parse(absolutePath);
  const parts = absolutePath.slice(parsed.root.length).split(path.sep).filter(Boolean);
  let current = parsed.root;
  for (const part of parts) {
    current = path.join(current, part);
    let metadata;
    try {
      metadata = await lstat(current);
    } catch (error) {
      throw missingOrInvalid(error);
    }
    if (metadata.isSymbolicLink()) {
      throw new RegistryError("PATH_CONTAINS_SYMLINK");
    }
  }
}

async function captureIdentity(absolutePath: string): Promise<{ device: number; inode: number }> {
  let handle: FileHandle;
  try {
    handle = await open(absolutePath, readOnlyNoSymlinksFlags());
  } catch (error) {
    throw missingOrInvalid(error);
  }
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile()) {
      throw new RegistryError("RESOURCE_CONFIGURATION_INVALID");
    }
    return { device: metadata.dev, inode: metadata.ino };
  } finally {
    await handle.close();
  }
}

export class ResourceRegistry {
  readonly #resources: ReadonlyMap<string, RegisteredResource>;

  private constructor(resources: ReadonlyMap<string, RegisteredResource>) {
    this.#resources = resources;
  }

  public static async create(
    storageRootInput: string,
    definitions: Readonly<Record<string, ResourceDefinition>>,
    workingDirectory: string,
  ): Promise<ResourceRegistry> {
    try {
      if (!path.isAbsolute(storageRootInput)) {
        throw new RegistryError();
      }
      const storageRoot = path.normalize(storageRootInput);
      const normalizedWorkingDirectory = path.resolve(workingDirectory);
      if (storageRoot === normalizedWorkingDirectory || isInside(normalizedWorkingDirectory, storageRoot)) {
        throw new RegistryError();
      }

      await assertNoSymlink(storageRoot);
      const storageMetadata = await stat(storageRoot);
      if (!storageMetadata.isDirectory() || (storageMetadata.mode & 0o777) !== 0o700) {
        throw new RegistryError("STORAGE_MODE_INVALID");
      }

      const records = new Map<string, RegisteredResource>();
      for (const [id, definition] of Object.entries(definitions)) {
        if (!path.isAbsolute(definition.path)) {
          throw new RegistryError();
        }
        const absolutePath = path.normalize(definition.path);
        if (!isInside(storageRoot, absolutePath)) {
          throw new RegistryError();
        }
        await assertNoSymlink(absolutePath);
        const identity = await captureIdentity(absolutePath);
        records.set(id, {
          id,
          absolutePath,
          device: identity.device,
          inode: identity.inode,
        });
      }
      return new ResourceRegistry(records);
    } catch (error) {
      if (error instanceof RegistryError) {
        throw error;
      }
      throw new RegistryError("RESOURCE_CONFIGURATION_INVALID");
    }
  }

  public has(id: string): boolean {
    return this.#resources.has(id);
  }

  public ids(): readonly string[] {
    return [...this.#resources.keys()].sort();
  }

  public async openVerified(id: string): Promise<FileHandle> {
    const resource = this.#resources.get(id);
    if (resource === undefined) {
      throw new ResourceChangedError();
    }

    let handle: FileHandle | undefined;
    try {
      handle = await open(resource.absolutePath, readOnlyNoSymlinksFlags());
      const metadata = await handle.stat();
      if (
        !metadata.isFile() ||
        metadata.dev !== resource.device ||
        metadata.ino !== resource.inode
      ) {
        throw new ResourceChangedError();
      }
      return handle;
    } catch (error) {
      if (handle !== undefined) {
        await handle.close().catch(() => undefined);
      }
      if (error instanceof ResourceChangedError) {
        throw error;
      }
      throw new ResourceChangedError();
    }
  }
}
