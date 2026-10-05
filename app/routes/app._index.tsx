import { useEffect } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";
import { adminContext } from "../lib/shopify/context.server";
import { runOutbox } from "../lib/b2b/outbox.server";
import {
  createWholesaleCatalog,
  ensureMetafieldDefinitions,
  seedDemoCatalog,
} from "../lib/b2b/store-setup";

const COMPANIES_COUNT = `#graphql
  query B2bOverview {
    companiesCount { count }
    shop { currencyCode plan { partnerDevelopment shopifyPlus } }
  }`;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { gateway, session } = await adminContext(request);
  const shop = session.shop;

  const [overview, pending, lastSync, outbox] = await Promise.all([
    gateway.request<{
      companiesCount: { count: number };
      shop: { currencyCode: string; plan: { partnerDevelopment: boolean; shopifyPlus: boolean } };
    }>(COMPANIES_COUNT),
    db.wholesaleApplication.count({ where: { shop, status: "PENDING" } }),
    db.syncJob.findFirst({ where: { shop }, orderBy: { startedAt: "desc" } }),
    db.outboxEvent.groupBy({ by: ["status"], where: { shop }, _count: true }),
  ]);

  const outboxCount = (status: string) => outbox.find((o) => o.status === status)?._count ?? 0;
  return {
    companies: overview.companiesCount.count,
    currency: overview.shop.currencyCode,
    b2bAvailable: overview.shop.plan.shopifyPlus || overview.shop.plan.partnerDevelopment,
    pendingApplications: pending,
    lastSync: lastSync && {
      status: lastSync.status,
      source: lastSync.source,
      startedAt: lastSync.startedAt.toISOString(),
    },
    outbox: { pending: outboxCount("PENDING"), sent: outboxCount("SENT"), dead: outboxCount("DEAD") },
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { gateway } = await adminContext(request);
  const intent = (await request.formData()).get("intent");

  try {
    switch (intent) {
      case "definitions": {
        const created = await ensureMetafieldDefinitions(gateway);
        return { ok: true, message: created.length ? `Created ${created.join(", ")}` : "Definitions already exist" };
      }
      case "seed":
        return { ok: true, message: `Seeded ${await seedDemoCatalog(gateway)} demo products` };
      case "catalog": {
        const shop = await gateway.request<{ shop: { currencyCode: string } }>(
          `#graphql
            query ShopCurrency { shop { currencyCode } }`,
        );
        await createWholesaleCatalog(gateway, {
          title: `Wholesale ${shop.shop.currencyCode}`,
          currency: shop.shop.currencyCode,
        });
        return { ok: true, message: "Wholesale catalog and price list created" };
      }
      case "outbox": {
        const report = await runOutbox();
        return { ok: true, message: `Outbox: ${report.sent} sent, ${report.failed} retried later, ${report.dead} dead` };
      }
      default:
        return { ok: false, message: "Unknown action" };
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
};

export default function Dashboard() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const busy = (intent: string) =>
    fetcher.state !== "idle" && fetcher.formData?.get("intent") === intent ? { loading: true } : {};
  const run = (intent: string) => fetcher.submit({ intent }, { method: "POST" });

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data) {
      shopify.toast.show(fetcher.data.message, { isError: !fetcher.data.ok });
    }
  }, [fetcher.state, fetcher.data, shopify]);

  return (
    <s-page heading="B2B Wholesale Hub">
      {!data.b2bAvailable && (
        <s-banner tone="warning" heading="B2B features unavailable">
          Companies, catalogs and price lists require Shopify Plus (or a Plus development store).
        </s-banner>
      )}

      <s-section heading="Overview">
        <s-grid gridTemplateColumns="repeat(4, 1fr)" gap="base">
          <Metric label="B2B companies" value={data.companies} />
          <Metric
            label="Applications to review"
            value={data.pendingApplications}
            href="/app/applications?status=PENDING"
          />
          <Metric label="Orders waiting for ERP" value={data.outbox.pending} />
          <Metric label="Dead letters" value={data.outbox.dead} tone={data.outbox.dead ? "critical" : undefined} />
        </s-grid>
      </s-section>

      <s-section heading="ERP integration">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            {data.lastSync ? (
              <>
                Last price sync from <s-text type="strong">{data.lastSync.source}</s-text> on{" "}
                {new Date(data.lastSync.startedAt).toLocaleString()} —{" "}
                <s-badge tone={data.lastSync.status === "SUCCEEDED" ? "success" : "warning"}>
                  {data.lastSync.status}
                </s-badge>
              </>
            ) : (
              "No price synchronisation yet."
            )}
          </s-paragraph>
          <s-stack direction="inline" gap="base">
            <s-button href="/app/price-sync">Open price sync</s-button>
            <s-button onClick={() => run("outbox")} {...busy("outbox")}>
              Deliver pending orders to ERP
            </s-button>
          </s-stack>
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Store setup">
        <s-stack direction="block" gap="base">
          <s-paragraph>Idempotent steps to prepare a development store for the demo.</s-paragraph>
          <s-button onClick={() => run("definitions")} {...busy("definitions")}>
            1. Create B2B metafield definitions
          </s-button>
          <s-button onClick={() => run("seed")} {...busy("seed")}>
            2. Seed demo catalog
          </s-button>
          <s-button onClick={() => run("catalog")} {...busy("catalog")}>
            3. Create wholesale catalog ({data.currency})
          </s-button>
        </s-stack>
      </s-section>
    </s-page>
  );
}

function Metric({
  label,
  value,
  href,
  tone,
}: {
  label: string;
  value: number;
  href?: string;
  tone?: "critical";
}) {
  return (
    <s-box padding="base" borderWidth="base" borderRadius="base">
      <s-stack direction="block" gap="small-200">
        <s-text color="subdued">{label}</s-text>
        <s-heading>
          {href ? <s-link href={href}>{value}</s-link> : <s-text tone={tone}>{value}</s-text>}
        </s-heading>
      </s-stack>
    </s-box>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
