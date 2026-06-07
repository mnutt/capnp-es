import { S as Struct, O as ObjectSize } from '../shared/capnp-es.DGklrAbf.js';

declare const _capnpFileId = 9710718097904890872n;
declare class StreamResult extends Struct {
    static readonly _capnp: {
        displayName: string;
        id: string;
        typeId: bigint;
        typeIdHex: string;
        size: ObjectSize;
        fields: readonly [];
    };
    toString(): string;
}

export { StreamResult, _capnpFileId };
