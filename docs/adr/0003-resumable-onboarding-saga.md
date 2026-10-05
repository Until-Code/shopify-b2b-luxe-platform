# ADR 0003 — Resumable onboarding saga

**Status**: accepted

## Context

Approving a trade account takes five Admin API calls (create the company, assign the role, the catalog and the metafields). Shopify has no multi-mutation transaction, and any call can fail (validation, throttling, network).

## Decision

* `companyCreate` creates the company, contact and location in one call. Its id is persisted immediately (`shopifyCompanyId`) as a checkpoint.
* Every subsequent step is idempotent: the role is assigned only if missing, while the catalog context and `metafieldsSet` are naturally idempotent.
* A failed approval leaves the application `PENDING` with the checkpoint. Approving again resumes the onboarding.

## Consequences

* No duplicate companies, and no manual clean-up after a partial failure.
* No compensation (deletion) logic is needed: a partially onboarded company has no catalog yet, so it can't order.
