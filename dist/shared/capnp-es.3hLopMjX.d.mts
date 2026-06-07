import { T as Transport, D as Deferred, M as Message } from './capnp-es.DGklrAbf.mjs';

declare abstract class DeferredTransport implements Transport {
    protected d?: Deferred<Message>;
    protected closed: boolean;
    protected closeError?: unknown;
    protected queue: Message[];
    abstract sendMessage(msg: Message): void;
    close(err?: unknown): void;
    recvMessage(): Promise<Message>;
    protected reject: (err: unknown) => void;
    protected resolve: (buf: ArrayBuffer | ArrayBufferView) => void;
}

export { DeferredTransport as D };
