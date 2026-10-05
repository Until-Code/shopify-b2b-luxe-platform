import type { ErpClient } from "../erp/types";
import { assertNoUserErrors, type AdminGateway, type UserError } from "../shopify/admin-gateway";
import { findVariantsBySku } from "../shopify/variants";
import { batchPricingInput, mapPriceRecords, type RejectedRecord } from "./price-list-mapping";

export interface SyncStats {
  received: number;
  applied: number;
  batches: number;
  unmatchedSkus: string[];
  rejected: RejectedRecord[];
}

export type SyncOutcome = "SUCCEEDED" | "PARTIAL";

const PRICE_LIST = `#graphql
  query PriceListCurrency($id: ID!) {
    priceList(id: $id) { id name currency }
  }`;

const QUANTITY_PRICING_UPDATE = `#graphql
  mutation QuantityPricingUpdate($priceListId: ID!, $input: QuantityPricingByVariantUpdateInput!) {
    quantityPricingByVariantUpdate(priceListId: $priceListId, input: $input) {
      productVariants { id }
      userErrors { field message code }
    }
  }`;

/** Shopify accepts up to 250 entries per list; 50 variants keeps every list well below. */
const VARIANTS_PER_BATCH = 50;

export class CurrencyMismatchError extends Error {
  constructor(erpCurrency: string, shopifyCurrency: string) {
    super(`ERP price list is in ${erpCurrency} but the Shopify price list is in ${shopifyCurrency}`);
    this.name = "CurrencyMismatchError";
  }
}

/**
 * Pulls a price list from the ERP and publishes it to a Shopify B2B price list:
 * fixed prices (with the MSRP as compare-at price), quantity rules (case packs)
 * and volume price breaks.
 */
export async function syncPriceList({
  gateway,
  erp,
  erpPriceListCode,
  priceListId,
}: {
  gateway: AdminGateway;
  erp: ErpClient;
  erpPriceListCode: string;
  priceListId: string;
}): Promise<{ outcome: SyncOutcome; stats: SyncStats }> {
  const [erpList, { priceList }] = await Promise.all([
    erp.fetchPriceList(erpPriceListCode),
    gateway.request<{ priceList: { currency: string } | null }>(PRICE_LIST, { id: priceListId }),
  ]);
  if (!priceList) throw new Error(`Price list ${priceListId} not found`);
  if (priceList.currency !== erpList.currency) {
    throw new CurrencyMismatchError(erpList.currency, priceList.currency);
  }

  const variants = await findVariantsBySku(
    gateway,
    erpList.records.map((r) => r.sku),
  );
  const mapping = mapPriceRecords(
    erpList.records,
    new Map([...variants].map(([sku, v]) => [sku, v.id])),
    erpList.currency,
  );

  const batches = batchPricingInput(mapping, VARIANTS_PER_BATCH);
  let applied = 0;
  for (const input of batches) {
    const data = await gateway.request<{
      quantityPricingByVariantUpdate: { productVariants: { id: string }[]; userErrors: UserError[] };
    }>(QUANTITY_PRICING_UPDATE, { priceListId, input });
    const payload = assertNoUserErrors(
      "quantityPricingByVariantUpdate",
      data.quantityPricingByVariantUpdate,
    );
    applied += payload.productVariants.length;
  }

  const stats: SyncStats = {
    received: erpList.records.length,
    applied,
    batches: batches.length,
    unmatchedSkus: mapping.unmatchedSkus,
    rejected: mapping.rejected,
  };
  const outcome: SyncOutcome =
    stats.unmatchedSkus.length || stats.rejected.length ? "PARTIAL" : "SUCCEEDED";
  return { outcome, stats };
}
