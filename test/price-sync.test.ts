import { describe, expect, it } from "vitest";
import { CurrencyMismatchError, syncPriceList } from "../app/lib/b2b/price-sync";
import { MockErpClient } from "../app/lib/erp/mock-erp-client";
import { ShopifyUserError } from "../app/lib/shopify/admin-gateway";
import { DEMO_CATALOG } from "../app/lib/b2b/demo-catalog";
import { fakeAdmin } from "./helpers";

// The demo catalog plus a product whose ERP record is invalid.
const demoVariants = [...DEMO_CATALOG.flatMap((p) => p.variants), { sku: "TB-BAD-RECORD", option: "Set" }].map((v, i) => ({
  id: `gid://shopify/ProductVariant/${i + 1}`,
  sku: v.sku,
  title: v.option,
  availableForSale: true,
  product: { title: "Demo", handle: "demo", vendor: "Northpeak", status: "ACTIVE" },
}));

function shopifyWith({ currency = "EUR", userErrors = [] as unknown[] } = {}) {
  return fakeAdmin({
    PriceListCurrency: () => ({ data: { priceList: { id: "gid://shopify/PriceList/1", name: "EU", currency } } }),
    VariantsBySku: ({ query }: { query: string }) => ({
      data: { productVariants: { nodes: demoVariants.filter((v) => query.includes(`"${v.sku}"`)) } },
    }),
    QuantityPricingUpdate: ({ input }: { input: { pricesToAdd: { variantId: string }[] } }) => ({
      data: {
        quantityPricingByVariantUpdate: {
          productVariants: input.pricesToAdd.map((p) => ({ id: p.variantId })),
          userErrors,
        },
      },
    }),
  });
}

describe("syncPriceList", () => {
  it("publishes valid records and reports the others (PARTIAL)", async () => {
    const shopify = shopifyWith();
    const { outcome, stats } = await syncPriceList({
      gateway: shopify.gateway,
      erp: new MockErpClient(),
      erpPriceListCode: "EU-WHOLESALE-EUR",
      priceListId: "gid://shopify/PriceList/1",
    });

    expect(outcome).toBe("PARTIAL");
    expect(stats).toMatchObject({
      received: 10,
      applied: 8,
      batches: 1,
      unmatchedSkus: ["NP-DISCONTINUED-01"],
    });
    expect(stats.rejected).toEqual([
      { sku: "TB-BAD-RECORD", reason: "minimum (5) must be a multiple of the increment (3)" },
    ]);
    expect(shopify.ops("QuantityPricingUpdate")).toHaveLength(1);
  });

  it("succeeds when every record is published", async () => {
    const { outcome } = await syncPriceList({
      gateway: shopifyWith({ currency: "USD" }).gateway,
      erp: new MockErpClient(),
      erpPriceListCode: "US-WHOLESALE-USD",
      priceListId: "gid://shopify/PriceList/2",
    });
    expect(outcome).toBe("SUCCEEDED");
  });

  it("refuses to publish prices in the wrong currency", async () => {
    const shopify = shopifyWith({ currency: "USD" });
    await expect(
      syncPriceList({
        gateway: shopify.gateway,
        erp: new MockErpClient(),
        erpPriceListCode: "EU-WHOLESALE-EUR",
        priceListId: "gid://shopify/PriceList/1",
      }),
    ).rejects.toBeInstanceOf(CurrencyMismatchError);
    expect(shopify.ops("QuantityPricingUpdate")).toHaveLength(0);
  });

  it("surfaces Shopify userErrors", async () => {
    const shopify = shopifyWith({
      userErrors: [{ field: ["input"], message: "Price list not found", code: "PRICE_LIST_NOT_FOUND" }],
    });
    await expect(
      syncPriceList({
        gateway: shopify.gateway,
        erp: new MockErpClient(),
        erpPriceListCode: "EU-WHOLESALE-EUR",
        priceListId: "gid://shopify/PriceList/1",
      }),
    ).rejects.toBeInstanceOf(ShopifyUserError);
  });
});
