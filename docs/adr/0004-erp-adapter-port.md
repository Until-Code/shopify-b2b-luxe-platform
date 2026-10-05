# ADR 0004 — ERP behind a port with a canonical model

**Status**: accepted

## Context

A multi-brand company often runs several ERPs (SAP for some business units, Dynamics for others) or an integration middleware (SAP CPI, MuleSoft, Boomi). The Shopify side should not change when the ERP does.

## Decision

* `ErpClient` is a port with a canonical model (`ErpPriceList`, `ErpOrder`). Amounts are decimal strings, never floats.
* Adapters: `MockErpClient` (fixtures, simulated failures) for development and demos, and `HttpErpClient` (timeouts, retries, `Retry-After`, `Idempotency-Key`) for a REST middleware.
* The adapter is chosen by configuration (`ERP_MODE`).

## Consequences

* Domain services and tests never depend on a vendor format.
* Adding an ERP means writing one adapter and its mapping tests.
