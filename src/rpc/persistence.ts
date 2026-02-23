export class MalformedSturdyRefError extends Error {
  override name = "MalformedSturdyRefError";
}

export class UnknownSturdyRefError extends Error {
  override name = "UnknownSturdyRefError";
}

export class UnsupportedRealmTransformError extends Error {
  override name = "UnsupportedRealmTransformError";
}

export interface SturdyRefCodec<TSturdyRef> {
  encode(ref: TSturdyRef): Uint8Array;
  decode(payload: Uint8Array): TSturdyRef;
}

export class JsonSturdyRefCodec<TSturdyRef> implements SturdyRefCodec<TSturdyRef> {
  #encoder = new TextEncoder();
  #decoder = new TextDecoder();

  constructor(
    private readonly validate?: (value: unknown) => value is TSturdyRef,
  ) {}

  encode(ref: TSturdyRef): Uint8Array {
    return this.#encoder.encode(JSON.stringify(ref));
  }

  decode(payload: Uint8Array): TSturdyRef {
    let raw: unknown;
    try {
      raw = JSON.parse(this.#decoder.decode(payload));
    } catch {
      throw new MalformedSturdyRefError("invalid sturdyRef payload");
    }
    if (this.validate && !this.validate(raw)) {
      throw new MalformedSturdyRefError("sturdyRef payload failed validation");
    }
    return raw as TSturdyRef;
  }
}

export type RealmTransform<TSturdyRef> = (ref: TSturdyRef) => TSturdyRef;

export class RealmTransformRegistry<TSturdyRef> {
  #transforms = new Map<string, RealmTransform<TSturdyRef>>();

  register(
    fromRealm: string,
    toRealm: string,
    transform: RealmTransform<TSturdyRef>,
  ): void {
    this.#transforms.set(`${fromRealm}->${toRealm}`, transform);
  }

  transform(ref: TSturdyRef, fromRealm: string, toRealm: string): TSturdyRef {
    if (fromRealm === toRealm) {
      return ref;
    }
    const fn = this.#transforms.get(`${fromRealm}->${toRealm}`);
    if (!fn) {
      throw new UnsupportedRealmTransformError(
        `unsupported sturdyRef realm transform: ${fromRealm} -> ${toRealm}`,
      );
    }
    return fn(ref);
  }
}

export interface RestorerLookup<TSturdyRef, TCapability> {
  restore(ref: TSturdyRef): Promise<TCapability> | TCapability;
}

export class MapRestorerLookup<TSturdyRef, TCapability>
  implements RestorerLookup<TSturdyRef, TCapability>
{
  #entries = new Map<string, TCapability>();

  constructor(
    entries?: Iterable<readonly [TSturdyRef, TCapability]>,
    private readonly keyOf: (ref: TSturdyRef) => string = (ref) =>
      JSON.stringify(ref),
  ) {
    if (entries) {
      for (const [ref, capability] of entries) {
        this.#entries.set(this.keyOf(ref), capability);
      }
    }
  }

  set(ref: TSturdyRef, capability: TCapability): void {
    this.#entries.set(this.keyOf(ref), capability);
  }

  restore(ref: TSturdyRef): TCapability {
    const key = this.keyOf(ref);
    if (!this.#entries.has(key)) {
      throw new UnknownSturdyRefError("unknown sturdyRef");
    }
    return this.#entries.get(key) as TCapability;
  }
}
