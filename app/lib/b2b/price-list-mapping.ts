import type { ErpPriceRecord } from "../erp/types";

/** Shapes of the Admin API `quantityPricingByVariantUpdate` input. */
export interface MoneyInput {
  amount: string;
  currencyCode: string;
}

export interface PriceListPriceInput {
  variantId: string;
  price: MoneyInput;
  compareAtPrice?: MoneyInput;
}

export interface QuantityRuleInput {
  variantId: string;
  minimum: number;
  maximum?: number;
  increment: number;
}

export interface QuantityPriceBreakInput {
  variantId: string;
  minimumQuantity: number;
  price: MoneyInput;
}

export interface QuantityPricingByVariantUpdateInput {
  pricesToAdd: PriceListPriceInput[];
  pricesToDeleteByVariantId: string[];
  quantityRulesToAdd: QuantityRuleInput[];
  quantityRulesToDeleteByVariantId: string[];
  quantityPriceBreaksToAdd: QuantityPriceBreakInput[];
  quantityPriceBreaksToDelete: string[];
  quantityPriceBreaksToDeleteByVariantId: string[];
}

export interface RejectedRecord {
  sku: string;
  reason: string;
}

export interface MappingResult {
  input: QuantityPricingByVariantUpdateInput;
  /** Variants included in `input`, in ERP order. */
  variantIds: string[];
  unmatchedSkus: string[];
  rejected: RejectedRecord[];
}

const DECIMAL = /^\d+(\.\d{1,4})?$/;

/** Returns a reason when the record cannot be published, `null` when it is valid. */
export function validatePriceRecord(record: ErpPriceRecord): string | null {
  if (!DECIMAL.test(record.unitPrice) || Number(record.unitPrice) <= 0) {
    return `invalid unit price "${record.unitPrice}"`;
  }
  if (record.retailPrice !== undefined && !DECIMAL.test(record.retailPrice)) {
    return `invalid retail price "${record.retailPrice}"`;
  }

  const increment = record.increment ?? 1;
  const minimum = record.minQuantity ?? increment;
  if (!Number.isInteger(increment) || increment < 1) return "increment must be a positive integer";
  if (!Number.isInteger(minimum) || minimum < 1) return "minimum must be a positive integer";
  if (minimum % increment !== 0) {
    return `minimum (${minimum}) must be a multiple of the increment (${increment})`;
  }
  if (record.maxQuantity !== undefined) {
    if (record.maxQuantity < minimum) return "maximum must be greater than the minimum";
    if (record.maxQuantity % increment !== 0) {
      return `maximum (${record.maxQuantity}) must be a multiple of the increment (${increment})`;
    }
  }

  let previousQuantity = minimum;
  let previousPrice = Number(record.unitPrice);
  for (const tier of record.tiers ?? []) {
    if (!DECIMAL.test(tier.unitPrice)) return `invalid tier price "${tier.unitPrice}"`;
    if (tier.minQuantity <= previousQuantity) {
      return `tier quantities must be strictly increasing (${tier.minQuantity})`;
    }
    if (tier.minQuantity % increment !== 0) {
      return `tier quantity ${tier.minQuantity} must be a multiple of the increment (${increment})`;
    }
    if (Number(tier.unitPrice) >= previousPrice) {
      return `tier price for ${tier.minQuantity}+ must be lower than the previous price`;
    }
    previousQuantity = tier.minQuantity;
    previousPrice = Number(tier.unitPrice);
  }
  return null;
}

/**
 * Maps ERP records to a single "full replace" quantity pricing update:
 * existing rules and price breaks of each variant are deleted, then the ERP
 * values are added. Re-running the same sync is therefore idempotent.
 */
export function mapPriceRecords(
  records: ErpPriceRecord[],
  variantIdsBySku: ReadonlyMap<string, string>,
  currencyCode: string,
): MappingResult {
  const result: MappingResult = {
    input: {
      pricesToAdd: [],
      pricesToDeleteByVariantId: [],
      quantityRulesToAdd: [],
      quantityRulesToDeleteByVariantId: [],
      quantityPriceBreaksToAdd: [],
      quantityPriceBreaksToDelete: [],
      quantityPriceBreaksToDeleteByVariantId: [],
    },
    variantIds: [],
    unmatchedSkus: [],
    rejected: [],
  };
  const money = (amount: string): MoneyInput => ({ amount, currencyCode });
  const seen = new Set<string>();

  for (const record of records) {
    if (seen.has(record.sku)) {
      result.rejected.push({ sku: record.sku, reason: "duplicate SKU in price list" });
      continue;
    }
    seen.add(record.sku);

    const variantId = variantIdsBySku.get(record.sku);
    if (!variantId) {
      result.unmatchedSkus.push(record.sku);
      continue;
    }
    const reason = validatePriceRecord(record);
    if (reason) {
      result.rejected.push({ sku: record.sku, reason });
      continue;
    }

    const increment = record.increment ?? 1;
    result.variantIds.push(variantId);
    result.input.pricesToAdd.push({
      variantId,
      price: money(record.unitPrice),
      ...(record.retailPrice ? { compareAtPrice: money(record.retailPrice) } : {}),
    });
    result.input.quantityRulesToDeleteByVariantId.push(variantId);
    result.input.quantityRulesToAdd.push({
      variantId,
      minimum: record.minQuantity ?? increment,
      increment,
      ...(record.maxQuantity !== undefined ? { maximum: record.maxQuantity } : {}),
    });
    result.input.quantityPriceBreaksToDeleteByVariantId.push(variantId);
    for (const tier of record.tiers ?? []) {
      result.input.quantityPriceBreaksToAdd.push({
        variantId,
        minimumQuantity: tier.minQuantity,
        price: money(tier.unitPrice),
      });
    }
  }

  return result;
}

/** Splits a mapping into API-sized batches, keeping each variant's data together. */
export function batchPricingInput(
  mapping: MappingResult,
  maxVariantsPerBatch: number,
): QuantityPricingByVariantUpdateInput[] {
  const batches: QuantityPricingByVariantUpdateInput[] = [];
  for (let i = 0; i < mapping.variantIds.length; i += maxVariantsPerBatch) {
    const ids = new Set(mapping.variantIds.slice(i, i + maxVariantsPerBatch));
    const has = (item: { variantId: string }) => ids.has(item.variantId);
    const { input } = mapping;
    batches.push({
      pricesToAdd: input.pricesToAdd.filter(has),
      pricesToDeleteByVariantId: [],
      quantityRulesToAdd: input.quantityRulesToAdd.filter(has),
      quantityRulesToDeleteByVariantId: input.quantityRulesToDeleteByVariantId.filter((id) => ids.has(id)),
      quantityPriceBreaksToAdd: input.quantityPriceBreaksToAdd.filter(has),
      quantityPriceBreaksToDelete: [],
      quantityPriceBreaksToDeleteByVariantId: input.quantityPriceBreaksToDeleteByVariantId.filter((id) =>
        ids.has(id),
      ),
    });
  }
  return batches;
}

/** Builds an Admin API search query matching any of the given SKUs. */
export function skuSearchQuery(skus: string[]): string {
  return skus.map((sku) => `sku:"${sku.replace(/(["\\])/g, "\\$1")}"`).join(" OR ");
}
