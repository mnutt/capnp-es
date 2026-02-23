import { describe, test, assert as t } from "vitest";
import {
  JsonIntroductionTokenCodec,
  MalformedIntroductionTokenError,
  ExpiredIntroductionTokenError,
  IntroductionTokenValidationError,
  assertIntroductionTokenFresh,
  isIntroductionToken,
  IntroductionToken,
} from "src/rpc/level3";

function token(nowMs: number): IntroductionToken<{ exportId: string }> {
  return {
    v: 1,
    kind: "thirdPartyCap",
    issuerVatId: "vat-b",
    audienceVatId: "vat-a",
    nonce: "nonce-1",
    issuedAtMs: nowMs,
    expiresAtMs: nowMs + 30_000,
    payload: {
      exportId: "exp-7",
    },
  };
}

describe("rpc level-3 profile", () => {
  test("json codec round-trips introduction tokens", () => {
    const codec = new JsonIntroductionTokenCodec<IntroductionToken>();
    const input = token(1_000);
    const output = codec.decode(codec.encode(input));
    t.deepEqual(output, input);
  });

  test("json codec rejects malformed payloads", () => {
    const codec = new JsonIntroductionTokenCodec<IntroductionToken>();
    const payload = new TextEncoder().encode("{not json");
    t.throws(() => codec.decode(payload), MalformedIntroductionTokenError);
  });

  test("json codec validation failure is deterministic", () => {
    const codec = new JsonIntroductionTokenCodec<IntroductionToken>(
      isIntroductionToken,
    );
    const payload = new TextEncoder().encode('{"v":1,"kind":"recipient"}');
    t.throws(() => codec.decode(payload), MalformedIntroductionTokenError);
  });

  test("freshness check accepts token within skew/tll bounds", () => {
    const nowMs = 10_000;
    const candidate = token(nowMs - 2_000);
    assertIntroductionTokenFresh(candidate, { nowMs, clockSkewMs: 5_000 });
  });

  test("freshness check rejects expired token", () => {
    const nowMs = 10_000;
    const candidate = token(nowMs - 40_000);
    t.throws(
      () =>
        assertIntroductionTokenFresh(candidate, {
          nowMs,
          clockSkewMs: 0,
        }),
      ExpiredIntroductionTokenError,
    );
  });

  test("freshness check rejects excessive ttl", () => {
    const nowMs = 10_000;
    const candidate = token(nowMs);
    candidate.expiresAtMs = nowMs + 120_000;
    t.throws(
      () =>
        assertIntroductionTokenFresh(candidate, {
          nowMs,
          maxTtlMs: 30_000,
        }),
      IntroductionTokenValidationError,
    );
  });

  test("freshness check rejects far-future issuance", () => {
    const nowMs = 10_000;
    const candidate = token(nowMs + 60_000);
    t.throws(
      () =>
        assertIntroductionTokenFresh(candidate, {
          nowMs,
          clockSkewMs: 5_000,
        }),
      IntroductionTokenValidationError,
    );
  });
});
