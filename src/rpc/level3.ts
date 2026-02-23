export class MalformedIntroductionTokenError extends Error {
  override name = "MalformedIntroductionTokenError";
}

export class ExpiredIntroductionTokenError extends Error {
  override name = "ExpiredIntroductionTokenError";
}

export class IntroductionTokenValidationError extends Error {
  override name = "IntroductionTokenValidationError";
}

export type IntroductionTokenKind = "recipient" | "thirdPartyCap" | "provision";

interface IntroductionTokenCommon<TPayload> {
  v: 1;
  issuerVatId: string;
  audienceVatId: string;
  nonce: string;
  issuedAtMs: number;
  expiresAtMs: number;
  payload: TPayload;
}

export type RecipientIntroductionToken<TPayload = unknown> =
  IntroductionTokenCommon<TPayload> & {
    kind: "recipient";
  };

export type ThirdPartyCapIntroductionToken<TPayload = unknown> =
  IntroductionTokenCommon<TPayload> & {
    kind: "thirdPartyCap";
  };

export type ProvisionIntroductionToken<TPayload = unknown> =
  IntroductionTokenCommon<TPayload> & {
    kind: "provision";
  };

export type IntroductionToken<TPayload = unknown> =
  | RecipientIntroductionToken<TPayload>
  | ThirdPartyCapIntroductionToken<TPayload>
  | ProvisionIntroductionToken<TPayload>;

export interface IntroductionTokenCodec<TToken> {
  encode(token: TToken): Uint8Array;
  decode(payload: Uint8Array): TToken;
}

export class JsonIntroductionTokenCodec<
  TToken,
> implements IntroductionTokenCodec<TToken> {
  #encoder = new TextEncoder();
  #decoder = new TextDecoder();

  constructor(
    private readonly validate?: (value: unknown) => value is TToken,
  ) {}

  encode(token: TToken): Uint8Array {
    return this.#encoder.encode(JSON.stringify(token));
  }

  decode(payload: Uint8Array): TToken {
    let raw: unknown;
    try {
      raw = JSON.parse(this.#decoder.decode(payload));
    } catch {
      throw new MalformedIntroductionTokenError(
        "invalid introduction token payload",
      );
    }
    if (this.validate && !this.validate(raw)) {
      throw new MalformedIntroductionTokenError(
        "introduction token payload failed validation",
      );
    }
    return raw as TToken;
  }
}

export interface IntroductionTokenFreshnessOptions {
  nowMs?: number;
  clockSkewMs?: number;
  maxTtlMs?: number;
}

const DEFAULT_CLOCK_SKEW_MS = 30_000;
const DEFAULT_MAX_TTL_MS = 5 * 60_000;

export function assertIntroductionTokenFresh(
  token: IntroductionToken,
  options: IntroductionTokenFreshnessOptions = {},
): void {
  if (!isIntroductionToken(token)) {
    throw new MalformedIntroductionTokenError("invalid introduction token");
  }

  const nowMs = options.nowMs ?? Date.now();
  const clockSkewMs = options.clockSkewMs ?? DEFAULT_CLOCK_SKEW_MS;
  const maxTtlMs = options.maxTtlMs ?? DEFAULT_MAX_TTL_MS;
  const { issuedAtMs, expiresAtMs } = token;

  if (!Number.isFinite(issuedAtMs) || !Number.isFinite(expiresAtMs)) {
    throw new MalformedIntroductionTokenError(
      "introduction token has invalid timestamp fields",
    );
  }

  if (expiresAtMs < issuedAtMs) {
    throw new MalformedIntroductionTokenError(
      "introduction token expires before issuance",
    );
  }

  if (expiresAtMs - issuedAtMs > maxTtlMs) {
    throw new IntroductionTokenValidationError(
      "introduction token TTL exceeds configured maximum",
    );
  }

  if (issuedAtMs > nowMs + clockSkewMs) {
    throw new IntroductionTokenValidationError(
      "introduction token issued in the future",
    );
  }

  if (expiresAtMs + clockSkewMs < nowMs) {
    throw new ExpiredIntroductionTokenError("introduction token expired");
  }
}

export function isIntroductionToken(
  value: unknown,
): value is IntroductionToken {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const token = value as Partial<IntroductionToken>;
  if (token.v !== 1) {
    return false;
  }

  return (
    isIntroductionTokenKind(token.kind) &&
    typeof token.issuerVatId === "string" &&
    token.issuerVatId.length > 0 &&
    typeof token.audienceVatId === "string" &&
    token.audienceVatId.length > 0 &&
    typeof token.nonce === "string" &&
    token.nonce.length > 0 &&
    typeof token.issuedAtMs === "number" &&
    typeof token.expiresAtMs === "number" &&
    "payload" in token
  );
}

export function isIntroductionTokenKind(
  value: unknown,
): value is IntroductionTokenKind {
  return (
    value === "recipient" || value === "thirdPartyCap" || value === "provision"
  );
}
