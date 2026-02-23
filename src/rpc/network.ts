import { Conn } from "./conn";

export class IntroductionAuthError extends Error {
  override name = "IntroductionAuthError";
}

export class IntroductionTokenRejectedError extends Error {
  override name = "IntroductionTokenRejectedError";
}

export class IntroducedConnectionNotFoundError extends Error {
  override name = "IntroducedConnectionNotFoundError";
}

export interface IntroductionPair<TRecipientId, TThirdPartyCapId> {
  sendToRecipient: TThirdPartyCapId;
  sendToTarget: TRecipientId;
}

export interface IntroducedConnection<TConnection, TProvisionId> {
  connection: TConnection;
  provisionId: TProvisionId;
}

export interface Level3NetworkAdapter<
  TConnection,
  TRecipientId,
  TThirdPartyCapId,
  TProvisionId,
> {
  introduceTo(
    recipientConnection: TConnection,
  ):
    | Promise<IntroductionPair<TRecipientId, TThirdPartyCapId>>
    | IntroductionPair<TRecipientId, TThirdPartyCapId>;

  connectToIntroduced(
    thirdPartyCapId: TThirdPartyCapId,
  ):
    | Promise<IntroducedConnection<TConnection, TProvisionId>>
    | IntroducedConnection<TConnection, TProvisionId>;

  acceptIntroducedConnection(
    recipientId: TRecipientId,
  ): Promise<TConnection> | TConnection;
}

export type IntroductionTraceEvent =
  | { type: "introduce_to_start"; atMs: number }
  | { type: "introduce_to_success"; atMs: number }
  | { type: "introduce_to_error"; atMs: number; error: Error }
  | { type: "connect_to_introduced_start"; atMs: number }
  | { type: "connect_to_introduced_success"; atMs: number }
  | { type: "connect_to_introduced_error"; atMs: number; error: Error }
  | { type: "accept_introduced_start"; atMs: number }
  | { type: "accept_introduced_success"; atMs: number }
  | { type: "accept_introduced_error"; atMs: number; error: Error }
  | { type: "vat_connect_start"; atMs: number; vatId: string }
  | { type: "vat_connect_success"; atMs: number; vatId: string }
  | { type: "vat_connect_reused"; atMs: number; vatId: string }
  | { type: "vat_connect_error"; atMs: number; vatId: string; error: Error }
  | { type: "vat_close"; atMs: number; vatId: string }
  | { type: "vat_close_all"; atMs: number };

export type IntroductionTraceHook = (event: IntroductionTraceEvent) => void;

export function withLevel3AdapterTracing<
  TConnection,
  TRecipientId,
  TThirdPartyCapId,
  TProvisionId,
>(
  adapter: Level3NetworkAdapter<
    TConnection,
    TRecipientId,
    TThirdPartyCapId,
    TProvisionId
  >,
  trace: IntroductionTraceHook,
): Level3NetworkAdapter<
  TConnection,
  TRecipientId,
  TThirdPartyCapId,
  TProvisionId
> {
  const now = (): number => Date.now();
  const normalize = (error_: unknown): Error =>
    error_ instanceof Error ? error_ : new Error(String(error_));

  return {
    async introduceTo(recipientConnection) {
      trace({ type: "introduce_to_start", atMs: now() });
      try {
        const out = await adapter.introduceTo(recipientConnection);
        trace({ type: "introduce_to_success", atMs: now() });
        return out;
      } catch (error_) {
        const error = normalize(error_);
        trace({ type: "introduce_to_error", atMs: now(), error });
        throw error;
      }
    },

    async connectToIntroduced(thirdPartyCapId) {
      trace({ type: "connect_to_introduced_start", atMs: now() });
      try {
        const out = await adapter.connectToIntroduced(thirdPartyCapId);
        trace({ type: "connect_to_introduced_success", atMs: now() });
        return out;
      } catch (error_) {
        const error = normalize(error_);
        trace({ type: "connect_to_introduced_error", atMs: now(), error });
        throw error;
      }
    },

    async acceptIntroducedConnection(recipientId) {
      trace({ type: "accept_introduced_start", atMs: now() });
      try {
        const out = await adapter.acceptIntroducedConnection(recipientId);
        trace({ type: "accept_introduced_success", atMs: now() });
        return out;
      } catch (error_) {
        const error = normalize(error_);
        trace({ type: "accept_introduced_error", atMs: now(), error });
        throw error;
      }
    },
  };
}

export interface VatConnectionManagerOptions<TVatId> {
  connect(vatId: TVatId): Promise<Conn> | Conn;
  keyOf?: (vatId: TVatId) => string;
  trace?: IntroductionTraceHook;
}

export class VatConnectionManager<TVatId> {
  #connect: (vatId: TVatId) => Promise<Conn> | Conn;
  #keyOf: (vatId: TVatId) => string;
  #trace?: IntroductionTraceHook;
  #connections = new Map<string, Conn>();
  #pending = new Map<string, Promise<Conn>>();

  constructor(options: VatConnectionManagerOptions<TVatId>) {
    this.#connect = options.connect;
    this.#keyOf = options.keyOf ?? ((vatId) => String(vatId));
    this.#trace = options.trace;
  }

  async get(vatId: TVatId): Promise<Conn> {
    const key = this.#keyOf(vatId);
    const existing = this.#connections.get(key);
    if (existing) {
      this.#trace?.({ type: "vat_connect_reused", atMs: Date.now(), vatId: key });
      return existing;
    }

    const pending = this.#pending.get(key);
    if (pending) {
      return pending;
    }

    this.#trace?.({ type: "vat_connect_start", atMs: Date.now(), vatId: key });
    const next = Promise.resolve(this.#connect(vatId))
      .then((conn) => {
        this.#pending.delete(key);
        this.#connections.set(key, conn);
        this.#trace?.({
          type: "vat_connect_success",
          atMs: Date.now(),
          vatId: key,
        });
        return conn;
      })
      .catch((error_: unknown) => {
        this.#pending.delete(key);
        const error =
          error_ instanceof Error ? error_ : new Error(String(error_));
        this.#trace?.({ type: "vat_connect_error", atMs: Date.now(), vatId: key, error });
        throw error;
      });

    this.#pending.set(key, next);
    return next;
  }

  has(vatId: TVatId): boolean {
    return this.#connections.has(this.#keyOf(vatId));
  }

  close(vatId: TVatId): void {
    const key = this.#keyOf(vatId);
    this.#pending.delete(key);
    const conn = this.#connections.get(key);
    if (!conn) {
      return;
    }
    this.#connections.delete(key);
    this.#trace?.({ type: "vat_close", atMs: Date.now(), vatId: key });
    conn.shutdown();
  }

  closeAll(): void {
    this.#pending.clear();
    for (const [key, conn] of this.#connections) {
      this.#trace?.({ type: "vat_close", atMs: Date.now(), vatId: key });
      conn.shutdown();
    }
    this.#connections.clear();
    this.#trace?.({ type: "vat_close_all", atMs: Date.now() });
  }

  get size(): number {
    return this.#connections.size;
  }
}
