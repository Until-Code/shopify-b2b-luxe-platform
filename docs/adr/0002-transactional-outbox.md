# ADR 0002 — Transactional outbox for ERP order export

**Status**: accepted

## Context

Shopify delivers webhooks *at least once* and expects a response within 5 seconds. ERPs are slow, sometimes unavailable, and must not receive the same order twice.

## Decision

* The `orders/create` handler deduplicates on `X-Shopify-Webhook-Id`, maps the order to the canonical ERP format and inserts an `OutboxEvent` (unique on shop + topic + order GID), then returns 200 straight away.
* A processor (`processOutbox`) delivers due events. It is triggered by cron and from the dashboard. On failure it schedules the next attempt with exponential backoff (1 min → 6 h). After 8 attempts the event is moved to `DEAD` and surfaced in the dashboard.
* The order GID is sent as an `Idempotency-Key` so the ERP can deduplicate too.

## Consequences

* No order is lost if the ERP is down, and none is duplicated if Shopify retries.
* Delivery is asynchronous (minutes, not milliseconds), which is acceptable for B2B fulfilment.
* At scale, the processor can move to a dedicated worker or queue (SQS, Pub/Sub) without changing the domain code. `OutboxRepository` is an interface.
