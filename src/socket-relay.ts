#!/usr/bin/env node
import net from "node:net";
import { lstat } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export type SocketRelayErrorCode =
  | "INVALID_ARGUMENTS"
  | "SOCKET_DESTINATION_INVALID"
  | "SOCKET_CONNECTION_FAILED";

export class SocketRelayError extends Error {
  public constructor(public readonly code: SocketRelayErrorCode) {
    super(`SubjectBroker socket relay failed: ${code}`);
    this.name = "SocketRelayError";
  }
}

export function parseSocketRelayArguments(args: readonly string[]): string {
  if (args.length !== 2 || args[0] !== "--socket" || !args[1]?.startsWith("/")) {
    throw new SocketRelayError("INVALID_ARGUMENTS");
  }
  return args[1];
}

export async function assertSocketDestination(socketPath: string): Promise<void> {
  try {
    const destination = await lstat(socketPath);
    const expectedUid = typeof process.getuid === "function" ? process.getuid() : undefined;
    if (
      !destination.isSocket() ||
      (destination.mode & 0o777) !== 0o600 ||
      (expectedUid !== undefined && destination.uid !== expectedUid)
    ) {
      throw new SocketRelayError("SOCKET_DESTINATION_INVALID");
    }
  } catch (error) {
    if (error instanceof SocketRelayError) {
      throw error;
    }
    throw new SocketRelayError("SOCKET_DESTINATION_INVALID");
  }
}

export async function runSocketRelay(socketPath: string): Promise<void> {
  await assertSocketDestination(socketPath);
  const socket = net.createConnection(socketPath);
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", () => reject(new SocketRelayError("SOCKET_CONNECTION_FAILED")));
  });
  process.stdin.pipe(socket);
  socket.pipe(process.stdout);
  await new Promise<void>((resolve, reject) => {
    socket.once("close", resolve);
    socket.once("error", () => reject(new SocketRelayError("SOCKET_CONNECTION_FAILED")));
  });
}

async function runCli(): Promise<void> {
  try {
    await runSocketRelay(parseSocketRelayArguments(process.argv.slice(2)));
  } catch (error) {
    const code = error instanceof SocketRelayError ? error.code : "SOCKET_CONNECTION_FAILED";
    process.stderr.write(`SubjectBroker socket relay failed: ${code}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runCli();
}
