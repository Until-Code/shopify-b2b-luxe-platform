# Architecture

## Principles

1. **Shopify is the system of engagement, the ERP is the system of record** for prices, customers' credit and orders. Shopify-native B2B primitives are used wherever they exist (companies, catalogs, price lists, quantity rules, payment terms), and custom code only fills the gaps.
2. **Rules run where they can't be bypassed.** Business rules that protect revenue or the brand (brand authorization, case packs, minimum order value) run in a Shopify Function, so they apply on the Online Store, a headless storefront and the Storefront API alike. Theme code only improves the UX.
3. **Integrations tolerate failure.** Every call to an external system is idempotent, retried with backoff and observable from the admin.
4. **The domain is framework-free.** `app/lib` doesn't import React Router or Prisma, which keeps it testable and portable (for example to a queue worker).

## Flows

### 1. Trade account onboarding

```mermaid
sequenceDiagram
  actor Retailer
  participant Theme as Theme (wholesale-application block)
  participant Proxy as App proxy
  participant App
  participant Admin as Admin GraphQL
  actor Sales as Trade team

  Retailer->>Theme: Fill in the application
  Theme->>Proxy: POST /apps/wholesale (FormData)
  Proxy->>App: Signed request (HMAC)
  App->>App: zod validation, honeypot, dedupe by email
  App-->>Retailer: 201 (same answer if the email exists)
  Sales->>App: Approve (catalog, payment terms, brands, minimum)
  App->>Admin: companyCreate (company + contact + location)
  App->>App: persist shopifyCompanyId (saga checkpoint)
  App->>Admin: companyContactAssignRole ("Ordering only")
  App->>Admin: catalogContextUpdate (location → catalog)
  App->>Admin: metafieldsSet (authorized brands, minimum order)
```

Each step after `companyCreate` is idempotent. If a step fails, approving again resumes from the checkpoint instead of creating a duplicate company ([ADR 0003](adr/0003-resumable-onboarding-saga.md)).

### 2. ERP price list → Shopify B2B price list

```mermaid
sequenceDiagram
  participant Admin UI
  participant Sync as syncPriceList
  participant ERP
  participant Shopify as Admin GraphQL

  Admin UI->>Sync: ERP code + price list id
  par
    Sync->>ERP: GET /price-lists/:code
    Sync->>Shopify: priceList(id) { currency }
  end
  Sync->>Sync: currency guard
  Sync->>Shopify: productVariants(query: "sku:… OR sku:…") (batches of 50)
  Sync->>Sync: validate + map (unknown / rejected SKUs reported)
  loop batches of 50 variants
    Sync->>Shopify: quantityPricingByVariantUpdate (prices, rules, breaks)
  end
  Sync-->>Admin UI: SUCCEEDED / PARTIAL + report (SyncJob)
```

* **Full replace per variant**: existing quantity rules and price breaks are deleted in the same mutation, so a re-run converges to the ERP state.
* **Validation before publication**: Shopify's constraints are checked locally (minimum multiple of increment, increasing tiers, decreasing prices…). A bad record is reported and doesn't fail the whole list.
* **MSRP** is published as the price list's compare-at price, so the theme can show "wholesale vs. retail" without extra data.

### 3. Order → ERP (transactional outbox)

```mermaid
flowchart LR
  W["orders/create webhook"] --> V{"B2B order?"}
  V -- no --> OK["200"]
  V -- yes --> D{"Webhook id already processed?"}
  D -- yes --> OK
  D -- no --> O[("OutboxEvent PENDING")] --> OK
  C["Cron / dashboard"] --> P["processOutbox"]
  P --> O
  P -->|"pushOrder (Idempotency-Key = order GID)"| E[("ERP")]
  P -->|"failure: attempts+1, next in 1, 2, 4… min"| O
  P -->|"8th failure"| DLQ[("DEAD")]
```

The webhook handler only writes to the database and returns within Shopify's 5-second budget. Delivery is decoupled, at-least-once and idempotent end to end ([ADR 0002](adr/0002-transactional-outbox.md)).

## Shopify API usage

| Concern | Choice |
| --- | --- |
| API version | Pinned to `2026-10` in the app, webhooks and codegen. CI validates every document against that schema. |
| Rate limits | `AdminGateway` reads `extensions.cost.throttleStatus` and waits exactly as long as the bucket needs to refill before retrying `THROTTLED` responses. |
| Errors | Top-level GraphQL errors throw `ShopifyGraphqlError` (not retried). `userErrors` throw `ShopifyUserError` with field paths. 5xx responses are retried with full-jitter backoff. |
| Bulk volumes | The sync batches 50 variants per mutation. For catalogs above roughly 10k SKUs, the next step is `bulkOperationRunMutation` with a JSONL upload; the mapping layer already produces per-variant inputs. |

## Security

* Admin routes: `authenticate.admin` (session token, embedded app).
* App proxy: `authenticate.public.appProxy` verifies Shopify's HMAC signature. Quick order is restricted to logged-in customers (`logged_in_customer_id`) and never returns prices.
* Webhooks: `authenticate.webhook` (HMAC), deduplicated with `X-Shopify-Webhook-Id`.
* Cron endpoint: bearer secret compared with `timingSafeEqual`.
* Personal data: stored only in `WholesaleApplication`, and deleted on `customers/redact` and `shop/redact`.

## Going to production

* Database: switch the Prisma datasource to PostgreSQL. The schema is portable, and the string statuses can become enums.
* Hosting: the Dockerfile runs on Fly.io, Render, Cloud Run, etc. Set `ERP_MODE=http`, `ERP_BASE_URL`, `ERP_API_KEY` and `JOBS_SECRET`.
* Observability: the `SyncJob` and `OutboxEvent` tables already give an audit trail. Ship logs to the group's platform (Datadog, ELK…) and alert on `DEAD` events.
