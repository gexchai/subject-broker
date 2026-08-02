import net, { type Socket } from "node:net";
import { ReadBuffer, serializeMessage } from "@modelcontextprotocol/sdk/shared/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

abstract class UnixSocketTransportBase implements Transport {
  public onclose?: () => void;
  public onerror?: (error: Error) => void;
  public onmessage?: (message: JSONRPCMessage) => void;

  protected readonly readBuffer = new ReadBuffer();
  protected socket: Socket | undefined;
  protected started = false;
  private closed = false;

  protected attach(socket: Socket): void {
    this.socket = socket;
    socket.on("data", (chunk: Buffer) => {
      this.readBuffer.append(chunk);
      while (true) {
        try {
          const message = this.readBuffer.readMessage();
          if (message === null) {
            return;
          }
          this.onmessage?.(message);
        } catch (error) {
          this.onerror?.(error instanceof Error ? error : new Error("Invalid MCP message"));
        }
      }
    });
    socket.on("error", (error) => this.onerror?.(error));
    socket.on("close", () => this.notifyClosed());
  }

  protected notifyClosed(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.readBuffer.clear();
    this.onclose?.();
  }

  public async send(message: JSONRPCMessage): Promise<void> {
    const socket = this.socket;
    if (socket === undefined || socket.destroyed) {
      throw new Error("Unix socket transport is not connected");
    }
    await new Promise<void>((resolve, reject) => {
      socket.write(serializeMessage(message), (error) => {
        if (error === null || error === undefined) {
          resolve();
        } else {
          reject(error);
        }
      });
    });
  }

  public async close(): Promise<void> {
    const socket = this.socket;
    if (socket !== undefined && !socket.destroyed) {
      await new Promise<void>((resolve) => {
        socket.once("close", resolve);
        socket.destroy();
      });
    }
    this.notifyClosed();
  }

  public abstract start(): Promise<void>;
}

export class UnixSocketServerTransport extends UnixSocketTransportBase {
  public constructor(socket: Socket) {
    super();
    this.socket = socket;
  }

  public async start(): Promise<void> {
    if (this.started) {
      throw new Error("Unix socket server transport already started");
    }
    this.started = true;
    const socket = this.socket;
    if (socket === undefined) {
      throw new Error("Unix socket server transport has no socket");
    }
    this.attach(socket);
  }
}

export class UnixSocketClientTransport extends UnixSocketTransportBase {
  public constructor(private readonly socketPath: string) {
    super();
  }

  public async start(): Promise<void> {
    if (this.started) {
      throw new Error("Unix socket client transport already started");
    }
    this.started = true;
    const socket = net.createConnection(this.socketPath);
    this.attach(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("error", reject);
    });
  }
}
