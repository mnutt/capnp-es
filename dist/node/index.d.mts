import { Duplex } from 'stream';
import { F as Finalize, M as Message, a as Message$1, C as Conn } from '../shared/capnp-es.DGklrAbf.mjs';
import { D as Data } from '../shared/capnp-es.Bi8mSfW-.mjs';
import { D as DeferredTransport } from '../shared/capnp-es.3hLopMjX.mjs';

interface NodeRpcTransportOptions {
    maxQueuedBytes?: number;
    signal?: AbortSignal;
}
interface ConnectNodeRpcOptions extends NodeRpcTransportOptions {
    path?: string;
    fd?: number;
    host?: string;
    port?: number;
    stream?: Duplex;
    finalize?: Finalize;
}
interface MessageToBufferOptions {
    packed?: boolean;
}
declare class NodeRpcTransport extends DeferredTransport {
    private readonly stream;
    private readonly decoder;
    private readonly maxQueuedBytes;
    private closeRequested;
    private waitingForDrain;
    private writeQueue;
    private queuedBytes;
    private readonly signal?;
    constructor(stream: Duplex, options?: NodeRpcTransportOptions);
    sendMessage(msg: Message): void;
    close(): void;
    private enqueueWrite;
    private flushWrites;
    private fail;
    private cleanup;
    private readonly onData;
    private readonly onDrain;
    private readonly onError;
    private readonly onClose;
    private readonly onEnd;
    private readonly onAbort;
}
declare function transportFromDuplex(stream: Duplex, options?: NodeRpcTransportOptions): NodeRpcTransport;
/**
 * Serialize a message into a Node Buffer.
 *
 * The returned Buffer is backed by a new ArrayBuffer containing a serialized copy of the message bytes. Mutating the
 * Buffer will not mutate the message.
 */
declare function messageToBuffer(message: Message$1, options?: MessageToBufferOptions): Buffer;
/**
 * Copy a Cap'n Proto Data pointer into a Node Buffer.
 *
 * Mutating the returned Buffer will not mutate the message.
 */
declare function copyDataToBuffer(data: Data): Buffer;
/**
 * Create a Node Buffer view over a Cap'n Proto Data pointer.
 *
 * The returned Buffer references the message segment. Mutating the Buffer mutates the message, and the view must not be
 * used after the message storage is discarded.
 */
declare function viewDataAsBuffer(data: Data): Buffer;
declare function connectNodeRpc(options: ConnectNodeRpcOptions): Promise<Conn>;
declare function connectNodeTransport(options: ConnectNodeRpcOptions): Promise<NodeRpcTransport>;

export { NodeRpcTransport, connectNodeRpc, connectNodeTransport, copyDataToBuffer, messageToBuffer, transportFromDuplex, viewDataAsBuffer };
export type { ConnectNodeRpcOptions, MessageToBufferOptions, NodeRpcTransportOptions };
