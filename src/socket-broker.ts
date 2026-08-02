import net, { type Server } from "node:net";
import { chmod, lstat, unlink } from "node:fs/promises";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SubjectBroker, type BrokerOptions } from "./broker.js";
import { createMcpServer } from "./mcp-server.js";
import { UnixSocketServerTransport } from "./unix-socket-transport.js";

export interface SocketBrokerHandle {
  readonly socketPath: string;
  close(): Promise<void>;
}

async function assertSocketPathAbsent(socketPath: string): Promise<void> {
  try {
    await lstat(socketPath);
    throw new Error("Socket path already exists");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
}

export async function startSocketBroker(
  options: BrokerOptions,
  serverName: string,
  socketPath: string,
): Promise<SocketBrokerHandle> {
  await assertSocketPathAbsent(socketPath);
  const broker = await SubjectBroker.create(options);
  const sessions = new Set<McpServer>();
  const server = net.createServer((socket) => {
    const mcpServer = createMcpServer(broker, serverName);
    sessions.add(mcpServer);
    const transport = new UnixSocketServerTransport(socket);
    const removeSession = () => sessions.delete(mcpServer);
    transport.onclose = removeSession;
    void mcpServer.connect(transport).catch(() => {
      removeSession();
      socket.destroy();
    });
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(socketPath);
  });
  await chmod(socketPath, 0o600);

  return {
    socketPath,
    close: async () => {
      await Promise.all([...sessions].map(async (session) => session.close()));
      await closeServer(server);
      try {
        await unlink(socketPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw error;
        }
      }
    },
  };
}
