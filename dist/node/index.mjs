import net from 'net';
import { M as Message, g as getStreamFrame } from '../shared/capnp-es.BbvJItGh.mjs';
import { D as DeferredTransport, C as Conn } from '../shared/capnp-es.B5WaHsoZ.mjs';
import { C as CapnpRpcError } from '../shared/capnp-es.CpncuNn1.mjs';
import { p as padToWord } from '../shared/capnp-es.DQO_cvul.mjs';
import '../shared/capnp-es.d92Owwob.mjs';
import '../capnp/rpc.mjs';
import '../shared/capnp-es.Cq4Gr-ie.mjs';

const DEFAULT_MAX_QUEUED_BYTES = 16 * 1024 * 1024;
const MAX_SEGMENT_COUNT = 4096;
const CONCAT_SMALL_FRAME_BYTES = 1024;
function disconnected(reason, cause) {
  return new CapnpRpcError(reason, {
    code: "disconnected",
    cause
  });
}
function abortError(reason) {
  if (reason instanceof Error) {
    return reason;
  }
  const err = new Error("operation aborted");
  err.name = "AbortError";
  return err;
}
class CapnpFrameDecoder {
  pending = Buffer.alloc(0);
  push(chunk) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    this.pending = this.pending.length === 0 ? buf : Buffer.concat([this.pending, buf]);
    const frames = [];
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
      frames.push(frame);
      this.pending = this.pending.subarray(frameBytes);
    }
    return frames;
  }
}
function messageToBufferChunks(message) {
  if (message._capnp.segments.length === 0) {
    message.getSegment(0);
  }
  const chunks = [Buffer.from(getStreamFrame(message))];
  let byteLength = chunks[0].byteLength;
  for (const segment of message._capnp.segments) {
    const chunk = Buffer.from(segment.buffer, 0, padToWord(segment.byteLength));
    chunks.push(chunk);
    byteLength += chunk.byteLength;
  }
  return byteLength <= CONCAT_SMALL_FRAME_BYTES ? [Buffer.concat(chunks, byteLength)] : chunks;
}
class NodeRpcTransport extends DeferredTransport {
  constructor(stream, options = {}) {
    super();
    this.stream = stream;
    this.maxQueuedBytes = options.maxQueuedBytes ?? DEFAULT_MAX_QUEUED_BYTES;
    this.signal = options.signal;
    this.stream.on("data", this.onData);
    this.stream.once("error", this.onError);
    this.stream.once("close", this.onClose);
    this.stream.once("end", this.onEnd);
    if (this.signal?.aborted) {
      this.fail(
        disconnected("transport aborted", abortError(this.signal.reason))
      );
    } else {
      this.signal?.addEventListener("abort", this.onAbort, { once: true });
    }
  }
  decoder = new CapnpFrameDecoder();
  maxQueuedBytes;
  closeRequested = false;
  waitingForDrain = false;
  writeQueue = [];
  queuedBytes = 0;
  signal;
  sendMessage(msg) {
    if (this.closed) {
      throw disconnected("transport closed", this.closeError);
    }
    let chunks;
    if (msg.segment.id === 0 && msg.byteOffset === 0) {
      chunks = messageToBufferChunks(msg.segment.message);
    } else {
      const m = new Message();
      m.setRoot(msg);
      chunks = messageToBufferChunks(m);
    }
    this.enqueueWrite(chunks);
  }
  close() {
    if (this.closed) {
      return;
    }
    this.closeRequested = true;
    this.cleanup();
    this.stream.destroy();
    super.close();
  }
  enqueueWrite(chunks) {
    const byteLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
    if (this.queuedBytes + byteLength > this.maxQueuedBytes) {
      const err = disconnected("transport write queue limit exceeded");
      this.fail(err);
      throw err;
    }
    this.writeQueue.push(...chunks);
    this.queuedBytes += byteLength;
    this.flushWrites();
  }
  flushWrites() {
    if (this.closed || this.waitingForDrain) {
      return;
    }
    while (this.writeQueue.length > 0) {
      const frame = this.writeQueue.shift();
      this.queuedBytes -= frame.byteLength;
      let canContinue;
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
  fail(err) {
    if (this.closed) {
      return;
    }
    this.cleanup();
    this.stream.destroy();
    super.close(err);
  }
  cleanup() {
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
  onData = (chunk) => {
    try {
      const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      for (const frame of this.decoder.push(bytes)) {
        this.resolve(frame);
      }
    } catch (error_) {
      this.fail(
        error_ instanceof Error ? error_ : disconnected("transport decode failed", error_)
      );
    }
  };
  onDrain = () => {
    this.waitingForDrain = false;
    this.flushWrites();
  };
  onError = (err) => {
    this.fail(disconnected("transport stream error", err));
  };
  onClose = () => {
    if (this.closeRequested) {
      this.cleanup();
      super.close();
      return;
    }
    this.fail(disconnected("transport stream closed"));
  };
  onEnd = () => {
    this.fail(disconnected("transport stream ended"));
  };
  onAbort = () => {
    this.fail(
      disconnected("transport aborted", abortError(this.signal?.reason))
    );
  };
}
function transportFromDuplex(stream, options) {
  return new NodeRpcTransport(stream, options);
}
function messageToBuffer(message, options = {}) {
  return Buffer.from(
    options.packed ? message.toPackedArrayBuffer() : message.toArrayBuffer()
  );
}
function copyDataToBuffer(data) {
  return Buffer.from(data.toArrayBuffer());
}
function viewDataAsBuffer(data) {
  const view = data.toUint8Array();
  return Buffer.from(view.buffer, view.byteOffset, view.byteLength);
}
async function connectNodeRpc(options) {
  const transport = await connectNodeTransport(options);
  return new Conn(transport, options.finalize);
}
async function connectNodeTransport(options) {
  if (options.stream) {
    return transportFromDuplex(options.stream, options);
  }
  if (options.fd !== void 0) {
    return transportFromDuplex(
      new net.Socket({
        fd: options.fd,
        readable: true,
        writable: true
      }),
      options
    );
  }
  if (options.path) {
    const socket = net.createConnection(options.path);
    await waitForConnect(socket, options.signal);
    return transportFromDuplex(socket, options);
  }
  if (options.port !== void 0) {
    const socket = net.createConnection({
      host: options.host ?? "127.0.0.1",
      port: options.port
    });
    await waitForConnect(socket, options.signal);
    return transportFromDuplex(socket, options);
  }
  throw new TypeError("connectNodeRpc() requires path, fd, stream, or port");
}
async function waitForConnect(socket, signal) {
  if (signal?.aborted) {
    socket.destroy();
    throw abortError(signal.reason);
  }
  await new Promise((resolve, reject) => {
    const cleanup = () => {
      socket.off("connect", onConnect);
      socket.off("error", onError);
      signal?.removeEventListener("abort", onAbort);
    };
    const onConnect = () => {
      cleanup();
      resolve();
    };
    const onError = (err) => {
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

export { NodeRpcTransport, connectNodeRpc, connectNodeTransport, copyDataToBuffer, messageToBuffer, transportFromDuplex, viewDataAsBuffer };
