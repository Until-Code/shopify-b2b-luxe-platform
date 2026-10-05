# ADR 0001 — Enforce B2B rules in a Shopify Function

**Status**: accepted

## Context

Brand authorization (distribution agreements), case packs and minimum order values protect the brands and their margins. They must hold whatever the sales channel: the Online Store, a future headless storefront or the Storefront API.

## Decision

Implement the rules as a **cart and checkout validation Function** (`extensions/b2b-order-rules`). It reads its configuration from metafields (company, company location, product), so the trade team can change it without a deployment.

The theme (quick order, trade pricing) only *anticipates* these rules for a better UX. It is never the enforcement point.

## Consequences

* The rules can't be bypassed by calling the Cart API directly.
* The minimum order value is only enforced from `CHECKOUT_INTERACTION` onwards, so buyers can still build their cart freely.
* Functions are deterministic and sandboxed (no network). Rules that need real-time ERP data (credit limit) would need `fetch` targets or a pre-computed metafield.
* Tests run against the compiled WASM in CI, with fixtures validated against the Function schema.
