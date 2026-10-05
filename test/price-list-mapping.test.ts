import { describe, expect, it } from "vitest";
import {
  batchPricingInput,
  mapPriceRecords,
  skuSearchQuery,
  validatePriceRecord,
} from "../app/lib/b2b/price-list-mapping";
import type { ErpPriceRecord } from "../app/lib/erp/types";

const record = (overrides: Partial<ErpPriceRecord> = {}): ErpPriceRecord => ({
  sku: "NP-ATP-ALU",
  unitPrice: "72.50",
  retailPrice: "145.00",
  minQuantity: 6,
  increment: 6,
  tiers: [
    { minQuantity: 24, unitPrice: "69.00" },
    { minQuantity: 48, unitPrice: "65.25" },
  ],
  ...overrides,
});

describe("validatePriceRecord", () => {
  it("accepts a consistent record", () => {
    expect(validatePriceRecord(record())).toBeNull();
  });

  it.each([
    [{ unitPrice: "0" }, "invalid unit price"],
    [{ unitPrice: "12,50" }, "invalid unit price"],
    [{ minQuantity: 5, increment: 3, tiers: [] }, "multiple of the increment"],
    [{ maxQuantity: 4 }, "maximum must be greater"],
    [{ maxQuantity: 100 }, "maximum (100) must be a multiple"],
    [{ tiers: [{ minQuantity: 6, unitPrice: "70.00" }] }, "strictly increasing"],
    [{ tiers: [{ minQuantity: 25, unitPrice: "70.00" }] }, "multiple of the increment"],
    [{ tiers: [{ minQuantity: 24, unitPrice: "80.00" }] }, "lower than the previous price"],
  ])("rejects %j", (overrides, reason) => {
    expect(validatePriceRecord(record(overrides))).toContain(reason);
  });
});

describe("mapPriceRecords", () => {
  const variants = new Map([
    ["NP-ATP-ALU", "gid://shopify/ProductVariant/1"],
    ["TB-BAD-RECORD", "gid://shopify/ProductVariant/2"],
  ]);

  it("builds a full-replace quantity pricing input", () => {
    const { input, variantIds, unmatchedSkus, rejected } = mapPriceRecords([record()], variants, "EUR");

    expect(variantIds).toEqual(["gid://shopify/ProductVariant/1"]);
    expect(unmatchedSkus).toEqual([]);
    expect(rejected).toEqual([]);
    expect(input.pricesToAdd).toEqual([
      {
        variantId: "gid://shopify/ProductVariant/1",
        price: { amount: "72.50", currencyCode: "EUR" },
        compareAtPrice: { amount: "145.00", currencyCode: "EUR" },
      },
    ]);
    expect(input.quantityRulesToAdd).toEqual([
      { variantId: "gid://shopify/ProductVariant/1", minimum: 6, increment: 6 },
    ]);
    expect(input.quantityPriceBreaksToAdd.map((b) => b.minimumQuantity)).toEqual([24, 48]);
    // Existing rules and breaks are removed first: re-running a sync is idempotent.
    expect(input.quantityRulesToDeleteByVariantId).toEqual(["gid://shopify/ProductVariant/1"]);
    expect(input.quantityPriceBreaksToDeleteByVariantId).toEqual(["gid://shopify/ProductVariant/1"]);
  });

  it("reports unknown SKUs, invalid records and duplicates without failing the batch", () => {
    const result = mapPriceRecords(
      [
        record(),
        record({ sku: "UNKNOWN" }),
        record({ sku: "TB-BAD-RECORD", minQuantity: 5, increment: 3, tiers: [] }),
        record(),
      ],
      variants,
      "EUR",
    );
    expect(result.variantIds).toHaveLength(1);
    expect(result.unmatchedSkus).toEqual(["UNKNOWN"]);
    expect(result.rejected.map((r) => r.sku)).toEqual(["TB-BAD-RECORD", "NP-ATP-ALU"]);
    expect(result.rejected[1].reason).toBe("duplicate SKU in price list");
  });

  it("defaults the minimum to the increment and omits optional fields", () => {
    const { input } = mapPriceRecords(
      [{ sku: "NP-ATP-ALU", unitPrice: "10.00", increment: 4 }],
      variants,
      "USD",
    );
    expect(input.quantityRulesToAdd[0]).toEqual({
      variantId: "gid://shopify/ProductVariant/1",
      minimum: 4,
      increment: 4,
    });
    expect(input.pricesToAdd[0]).not.toHaveProperty("compareAtPrice");
  });
});

describe("batchPricingInput", () => {
  it("splits by variant and keeps each variant's data in the same batch", () => {
    const records = Array.from({ length: 5 }, (_, i) => record({ sku: `SKU-${i}` }));
    const variants = new Map(records.map((r, i) => [r.sku, `gid://shopify/ProductVariant/${i}`]));
    const batches = batchPricingInput(mapPriceRecords(records, variants, "EUR"), 2);

    expect(batches.map((b) => b.pricesToAdd.length)).toEqual([2, 2, 1]);
    for (const batch of batches) {
      const ids = new Set(batch.pricesToAdd.map((p) => p.variantId));
      expect(batch.quantityPriceBreaksToAdd.every((b) => ids.has(b.variantId))).toBe(true);
      expect(batch.quantityRulesToAdd.every((r) => ids.has(r.variantId))).toBe(true);
    }
  });
});

describe("skuSearchQuery", () => {
  it("quotes and escapes SKUs", () => {
    expect(skuSearchQuery(["A-1", 'B"2'])).toBe('sku:"A-1" OR sku:"B\\"2"');
  });
});
