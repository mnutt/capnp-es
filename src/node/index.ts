// Meteor's Node 14 module resolver does not understand node: specifiers.
// eslint-disable-next-line unicorn/prefer-node-protocol
import net from "net";
// eslint-disable-next-line unicorn/prefer-node-protocol
import type { Duplex } from "stream";
import { Message } from "../serialization/message";
import type { Data } from "../serialization/pointers/data";
import { Message as RPCMessage } from "../capnp/rpc";
import { DeferredTransport } from "../rpc/transport/deferred-transport";
import { Conn } from "../rpc/conn";
import type { Finalize } from "../rpc/finalize";
import { CapnpRpcError } from "../rpc/rpc-error";

export interface NodeRpcTransportOptions {
  maxQueuedBytes?: number;
  signal?: AbortSignal;
}

export interface ConnectNodeRpcOptions extends NodeRpcTransportOptions {
  path?: string;
  fd?: number;
  host?: string;
  port?: number;
  stream?: Duplex;
  finalize?: Finalize;
}

export interface MessageToBufferOptions {
  packed?: boolean;
}

const DEFAULT_MAX_QUEUED_BYTES = 16 * 1024 * 1024;
const MAX_SEGMENT_COUNT = 4096;

function copyArrayBuffer(buf: Buffer): ArrayBuffer {
  const out = new Uint8Array(buf.byteLength);
  out.set(buf);
  return out.buffer;
}

function disconnected(reason: string, cause?: unknown): CapnpRpcError {
  return new CapnpRpcError(reason, {
    code: "disconnected",
    cause,
  });
}

function abortError(reason?: unknown): Error {
  if (reason instanceof Error) {
    return reason;
  }
  const err = new Error("operation aborted");
  err.name = "AbortError";
  return err;
}

class CapnpFrameDecoder {
  private pending: Buffer = Buffer.alloc(0);

  push(chunk: Buffer | Uint8Array): ArrayBuffer[] {
    const buf = Buffer.isBuffer(chunk)
      ? chunk
      : Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    this.pending =
      this.pending.length === 0 ? buf : Buffer.concat([this.pending, buf]);

    const frames: ArrayBuffer[] = [];

    while (true) {
      if (this.pending.length < 8) {
        break;
      }

      const segmentCount = this.pending.readUInt32LE(0) + 1;
      if (segmentCount <= 0 || segmentCount > MAX_SEGMENT_COUNT) {
        throw disconnected(`invalid segment count: ${segmentCount}`);
      }

      const tableInts = 1 + segmentCount;
      const headerWords = Math.ceil(tableInts / 2);
      const headerBytes = headerWords * 8;
      if (this.pending.length < headerBytes) {
        break;
      }

      let payloadWords = 0;
      for (let i = 0; i < segmentCount; i++) {
        payloadWords += this.pending.readUInt32LE(4 + i * 4);
      }

      const frameBytes = headerBytes + payloadWords * 8;
      if (this.pending.length < frameBytes) {
        break;
      }

      const frame = this.pending.subarray(0, frameBytes);
      frames.push(copyArrayBuffer(frame));
      this.pending = this.pending.subarray(frameBytes);
    }

    return frames;
  }
}

export class NodeRpcTransport extends DeferredTransport {
  private readonly decoder = new CapnpFrameDecoder();
  private readonly maxQueuedBytes: number;
  private closeRequested = false;
  private waitingForDrain = false;
  private writeQueue: Buffer[] = [];
  private queuedBytes = 0;
  private readonly signal?: AbortSignal;

  constructor(
    private readonly stream: Duplex,
    options: NodeRpcTransportOptions = {},
  ) {
    super();
    this.maxQueuedBytes = options.maxQueuedBytes ?? DEFAULT_MAX_QUEUED_BYTES;
    this.signal = options.signal;

    this.stream.on("data", this.onData);
    this.stream.once("error", this.onError);
    this.stream.once("close", this.onClose);
    this.stream.once("end", this.onEnd);

    if (this.signal?.aborted) {
      this.fail(
        disconnected("transport aborted", abortError(this.signal.reason)),
      );
    } else {
      this.signal?.addEventListener("abort", this.onAbort, { once: true });
    }
  }

  sendMessage(msg: RPCMessage): void {
    if (this.closed) {
      throw disconnected("transport closed", this.closeError);
    }

    let frame: Buffer;
    if (msg.segment.id === 0 && msg.byteOffset === 0) {
      frame = Buffer.from(msg.segment.message.toArrayBuffer());
    } else {
      const m = new Message();
      m.setRoot(msg);
      frame = Buffer.from(m.toArrayBuffer());
    }

    this.enqueueWrite(frame);
  }

  override close(): void {
    if (this.closed) {
      return;
    }
    this.closeRequested = true;
    this.cleanup();
    this.stream.destroy();
    super.close();
  }

  private enqueueWrite(frame: Buffer): void {
    if (this.queuedBytes + frame.byteLength > this.maxQueuedBytes) {
      const err = disconnected("transport write queue limit exceeded");
      this.fail(err);
      throw err;
    }

    this.writeQueue.push(frame);
    this.queuedBytes += frame.byteLength;
    this.flushWrites();
  }

  private flushWrites(): void {
    if (this.closed || this.waitingForDrain) {
      return;
    }

    while (this.writeQueue.length > 0) {
      const frame = this.writeQueue.shift()!;
      this.queuedBytes -= frame.byteLength;
      let canContinue: boolean;
      try {
        canContinue = this.stream.write(frame);
      } catch (error_) {
        this.fail(disconnected("transport write failed", error_));
        return;
      }

      if (!canContinue) {
        this.waitingForDrain = true;
        this.stream.once("drain", this.onDrain);
        return;
      }
    }
  }

  private fail(err: Error): void {
    if (this.closed) {
      return;
    }
    this.cleanup();
    this.stream.destroy();
    super.close(err);
  }

  private cleanup(): void {
    this.writeQueue = [];
    this.queuedBytes = 0;
    this.waitingForDrain = false;
    this.stream.off("data", this.onData);
    this.stream.off("error", this.onError);
    this.stream.off("close", this.onClose);
    this.stream.off("end", this.onEnd);
    this.stream.off("drain", this.onDrain);
    this.signal?.removeEventListener("abort", this.onAbort);
  }

  private readonly onData = (chunk: Buffer | Uint8Array | string): void => {
    try {
      const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      for (const frame of this.decoder.push(bytes)) {
        this.resolve(frame);
      }
    } catch (error_) {
      this.fail(
        error_ instanceof Error
          ? error_
          : disconnected("transport decode failed", error_),
      );
    }
  };

  private readonly onDrain = (): void => {
    this.waitingForDrain = false;
    this.flushWrites();
  };

  private readonly onError = (err: Error): void => {
    this.fail(disconnected("transport stream error", err));
  };

  private readonly onClose = (): void => {
    if (this.closeRequested) {
      this.cleanup();
      super.close();
      return;
    }
    this.fail(disconnected("transport stream closed"));
  };

  private readonly onEnd = (): void => {
    this.fail(disconnected("transport stream ended"));
  };

  private readonly onAbort = (): void => {
    this.fail(
      disconnected("transport aborted", abortError(this.signal?.reason)),
    );
  };
}

export function transportFromDuplex(
  stream: Duplex,
  options?: NodeRpcTransportOptions,
): NodeRpcTransport {
  return new NodeRpcTransport(stream, options);
}

/**
 * Serialize a message into a Node Buffer.
 *
 * The returned Buffer is backed by a new ArrayBuffer containing a serialized copy of the message bytes. Mutating the
 * Buffer will not mutate the message.
 */
export function messageToBuffer(
  message: Message,
  options: MessageToBufferOptions = {},
): Buffer {
  return Buffer.from(
    options.packed ? message.toPackedArrayBuffer() : message.toArrayBuffer(),
  );
}

/**
 * Copy a Cap'n Proto Data pointer into a Node Buffer.
 *
 * Mutating the returned Buffer will not mutate the message.
 */
export function copyDataToBuffer(data: Data): Buffer {
  return Buffer.from(data.toArrayBuffer());
}

/**
 * Create a Node Buffer view over a Cap'n Proto Data pointer.
 *
 * The returned Buffer references the message segment. Mutating the Buffer mutates the message, and the view must not be
 * used after the message storage is discarded.
 */
export function viewDataAsBuffer(data: Data): Buffer {
  const view = data.toUint8Array();
  return Buffer.from(view.buffer, view.byteOffset, view.byteLength);
}

export async function connectNodeRpc(
  options: ConnectNodeRpcOptions,
): Promise<Conn> {
  const transport = await connectNodeTransport(options);
  return new Conn(transport, options.finalize);
}

export async function connectNodeTransport(
  options: ConnectNodeRpcOptions,
): Promise<NodeRpcTransport> {
  if (options.stream) {
    return transportFromDuplex(options.stream, options);
  }

  if (options.fd !== undefined) {
    return transportFromDuplex(
      new net.Socket({
        fd: options.fd,
        readable: true,
        writable: true,
      }),
      options,
    );
  }

  if (options.path) {
    const socket = net.createConnection(options.path);
    await waitForConnect(socket, options.signal);
    return transportFromDuplex(socket, options);
  }

  if (options.port !== undefined) {
    const socket = net.createConnection({
      host: options.host ?? "127.0.0.1",
      port: options.port,
    });
    await waitForConnect(socket, options.signal);
    return transportFromDuplex(socket, options);
  }

  throw new TypeError("connectNodeRpc() requires path, fd, stream, or port");
}

async function waitForConnect(
  socket: net.Socket,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) {
    socket.destroy();
    throw abortError(signal.reason);
  }

  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      socket.off("connect", onConnect);
      socket.off("error", onError);
      signal?.removeEventListener("abort", onAbort);
    };
    const onConnect = () => {
      cleanup();
      resolve();
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };
    const onAbort = () => {
      cleanup();
      const err = abortError(signal?.reason);
      socket.destroy(err);
      reject(err);
    };

    socket.once("connect", onConnect);
    socket.once("error", onError);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
