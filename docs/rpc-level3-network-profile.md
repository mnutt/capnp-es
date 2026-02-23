# Cap'n Proto RPC Level 3 Network Profile (Initial)

This document defines the initial Level 3 network profile for `capnp-es`.

## Scope

- Applies only to Level 3 introduction identifiers:
  - `RecipientId`
  - `ThirdPartyCapId`
  - `ProvisionId`
- Two-party RPC remains fully supported without this profile.
- Level 4 (`Join`) remains out of scope for this phase.

## Token format (v1)

The initial profile standardizes on JSON tokens serialized as UTF-8 bytes:

- Use `JsonIntroductionTokenCodec` from `src/rpc/level3.ts`.
- Tokens are encoded/decoded as `Uint8Array`, which works in both Node and browsers.
- JSON payload allows easy app-specific extension while keeping deterministic runtime validation.

Canonical fields:

- `v`: profile version (currently `1`)
- `kind`: one of `recipient`, `thirdPartyCap`, `provision`
- `issuerVatId`: issuing vat identity
- `audienceVatId`: intended receiving vat identity
- `nonce`: unique nonce for replay resistance
- `issuedAtMs`: issuance timestamp
- `expiresAtMs`: expiry timestamp
- `payload`: app/network-specific claims

## Freshness and replay requirements

The runtime helper `assertIntroductionTokenFresh()` enforces:

- finite timestamp fields
- monotonic window (`expiresAtMs >= issuedAtMs`)
- bounded TTL (default 5 minutes)
- bounded clock skew (default 30 seconds)
- deterministic expired/future-token rejection errors

Network adapters must additionally enforce single-use nonce/replay protection
for the validity window.

## Authentication

This profile intentionally leaves cryptographic signing/verification pluggable
to adapters or applications. Required behavior:

- token integrity and issuer authenticity must be verified before use
- forged or unknown issuers must map to deterministic protocol failures

This keeps the core runtime portable across browser and Node environments while
allowing deployments to choose Ed25519, HMAC, mTLS-bound assertions, or other
schemes.

## Node + browser compatibility strategy

- Core profile code uses only Web Platform primitives (`TextEncoder`,
  `TextDecoder`, `Uint8Array`, `Date.now()`), so it is runtime-agnostic.
- No direct dependency on Node-only transport or crypto APIs in the profile.
- Node-specific transports/adapters can layer richer auth and networking.
- Browser adapters can use WebCrypto and WebTransport/WebSocket-compatible
  connection strategies with the same token schema.
