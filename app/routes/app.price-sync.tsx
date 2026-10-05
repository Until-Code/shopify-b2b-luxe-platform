import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";
import { adminContext } from "../lib/shopify/context.server";
import { getErpClient, MockErpClient } from "../lib/erp/index.server";
import { syncPriceList, type SyncStats } from "../lib/b2b/price-sync";

const PRICE_LISTS = `#graphql
  query B2bPriceLists {
    priceLists(first: 50) {
      nodes { id name currency catalog { title } }
    }
  }`;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { gateway, session } = await adminContext(request);
  const [{ priceLists }, jobs] = await Promise.all([
    gateway.request<{
      priceLists: { nodes: { id: string; name: string; currency: string; catalog: { title: string } | null }[] };
    }>(PRICE_LISTS),
    db.syncJob.findMany({ where: { shop: session.shop }, orderBy: { startedAt: "desc" }, take: 20 }),
  ]);
  return {
    priceLists: priceLists.nodes,
    erpPriceLists: process.env.ERP_MODE === "http" ? [] : MockErpClient.availablePriceLists(),
    jobs: jobs.map((j) => ({
      ...j,
      stats: j.stats ? (JSON.parse(j.stats) as SyncStats) : null,
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { gateway, session } = await adminContext(request);
  const form = await request.formData();
  const priceListId = String(form.get("priceListId") ?? "");
  const erpPriceListCode = String(form.get("erpPriceListCode") ?? "").trim();
  if (!priceListId || !erpPriceListCode) return { error: "Select both price lists" };

  const job = await db.syncJob.create({
    data: { shop: session.shop, type: "PRICE_LIST", source: erpPriceListCode, target: priceListId },
  });
  try {
    const { outcome, stats } = await syncPriceList({
      gateway,
      erp: getErpClient(),
      erpPriceListCode,
      priceListId,
    });
    await db.syncJob.update({
      where: { id: job.id },
      data: { status: outcome, stats: JSON.stringify(stats), finishedAt: new Date() },
    });
    return { outcome, stats };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.syncJob.update({
      where: { id: job.id },
      data: { status: "FAILED", error: message, finishedAt: new Date() },
    });
    return { error: message };
  }
};

const JOB_TONE = { SUCCEEDED: "success", PARTIAL: "warning", FAILED: "critical", RUNNING: "info" } as const;

export default function PriceSync() {
  const { priceLists, erpPriceLists, jobs } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const running = useNavigation().state === "submitting";

  return (
    <s-page heading="ERP price sync">
      {result?.error && (
        <s-banner tone="critical" heading="Synchronisation failed">
          {result.error}
        </s-banner>
      )}
      {result?.stats && result.outcome && (
        <s-banner tone={result.outcome === "SUCCEEDED" ? "success" : "warning"} heading={`Sync ${result.outcome.toLowerCase()}`}>
          {result.stats.applied}/{result.stats.received} SKUs published in {result.stats.batches} batch(es).
          {result.stats.unmatchedSkus.length > 0 && ` Unknown in Shopify: ${result.stats.unmatchedSkus.join(", ")}.`}
          {result.stats.rejected.length > 0 &&
            ` Rejected: ${result.stats.rejected.map((r) => `${r.sku} (${r.reason})`).join("; ")}.`}
        </s-banner>
      )}

      <s-section heading="Publish an ERP price list">
        <s-paragraph>
          Publishes B2B fixed prices (MSRP as compare-at price), quantity rules (case packs) and
          volume price breaks in a single idempotent operation per batch of 50 variants.
        </s-paragraph>
        <Form method="post">
          <s-stack direction="block" gap="base">
            {erpPriceLists.length ? (
              <s-select label="ERP price list" name="erpPriceListCode" required>
                {erpPriceLists.map((code) => (
                  <s-option key={code} value={code}>
                    {code}
                  </s-option>
                ))}
              </s-select>
            ) : (
              <s-text-field label="ERP price list code" name="erpPriceListCode" required />
            )}
            <s-select label="Shopify B2B price list" name="priceListId" required>
              <s-option value="">Select a price list</s-option>
              {priceLists.map((p) => (
                <s-option key={p.id} value={p.id}>
                  {p.name} — {p.currency}
                  {p.catalog ? ` (${p.catalog.title})` : ""}
                </s-option>
              ))}
            </s-select>
            <s-button type="submit" variant="primary" {...(running ? { loading: true } : {})}>
              Run synchronisation
            </s-button>
          </s-stack>
        </Form>
      </s-section>

      <s-section heading="History" padding="none">
        <s-table>
          <s-table-header-row>
            <s-table-header listSlot="primary">Source</s-table-header>
            <s-table-header>Started</s-table-header>
            <s-table-header>Applied</s-table-header>
            <s-table-header>Issues</s-table-header>
            <s-table-header listSlot="secondary">Status</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {jobs.map((job) => (
              <s-table-row key={job.id}>
                <s-table-cell>{job.source}</s-table-cell>
                <s-table-cell>{new Date(job.startedAt).toLocaleString()}</s-table-cell>
                <s-table-cell>
                  {job.stats ? `${job.stats.applied}/${job.stats.received}` : "—"}
                </s-table-cell>
                <s-table-cell>
                  {job.error ??
                    (job.stats
                      ? `${job.stats.unmatchedSkus.length} unknown, ${job.stats.rejected.length} rejected`
                      : "—")}
                </s-table-cell>
                <s-table-cell>
                  <s-badge tone={JOB_TONE[job.status as keyof typeof JOB_TONE]}>{job.status}</s-badge>
                </s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
