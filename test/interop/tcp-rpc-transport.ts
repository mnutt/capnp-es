import net from "node:net";
import { Message } from "src/serialization/message";
import { Message as RPCMessage } from "src/capnp/rpc";
import { DeferredTransport } from "src/rpc/transport/deferred-transport";

function copyArrayBuffer(buf: Buffer<ArrayBufferLike>): ArrayBuffer {
  const out = new Uint8Array(buf.byteLength);
  out.set(buf);
  return out.buffer;
}

class CapnpFrameDecoder {
  private pending: Buffer<ArrayBufferLike> = Buffer.alloc(0);

  push(chunk: Buffer<ArrayBufferLike>): ArrayBuffer[] {
    this.pending =
      this.pending.length === 0 ? chunk : Buffer.concat([this.pending, chunk]);

    const frames: ArrayBuffer[] = [];

    while (true) {
      if (this.pending.length < 8) {
        break;
      }

      const segmentCount = this.pending.readUInt32LE(0) + 1;
      if (segmentCount <= 0 || segmentCount > 4096) {
        throw new Error(`invalid segment count: ${segmentCount}`);
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

export class TcpRPCTransport extends DeferredTransport {
  private readonly decoder = new CapnpFrameDecoder();

  static async connect(host: string, port: number): Promise<TcpRPCTransport> {
    const socket = new net.Socket();
    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error) => {
        socket.off("connect", onConnect);
        reject(err);
      };
      const onConnect = () => {
        socket.off("error", onError);
        resolve();
      };
      socket.once("error", onError);
      socket.once("connect", onConnect);
      socket.connect(port, host);
    });
    return new TcpRPCTransport(socket);
  }

  static fromSocket(socket: net.Socket): TcpRPCTransport {
    return new TcpRPCTransport(socket);
  }

  constructor(private readonly socket: net.Socket) {
    super();

    this.socket.on("data", (chunk: Buffer) => {
      try {
        for (const frame of this.decoder.push(chunk)) {
          this.resolve(frame);
        }
      } catch (error_) {
        this.reject(error_);
      }
    });
    this.socket.on("error", this.reject);
    this.socket.on("close", () => this.close());
    this.socket.on("end", () => this.close());
  }

  sendMessage(msg: RPCMessage): void {
    const m = new Message();
    m.setRoot(msg);
    this.socket.write(Buffer.from(m.toArrayBuffer()));
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.socket.removeAllListeners("data");
    this.socket.removeAllListeners("error");
    this.socket.removeAllListeners("close");
    this.socket.removeAllListeners("end");
    this.socket.destroy();
    super.close();
  }
}
