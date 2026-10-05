import { chunk } from "../core/collections";
import { skuSearchQuery } from "../b2b/price-list-mapping";
import type { AdminGateway } from "./admin-gateway";

export interface VariantSummary {
  id: string;
  sku: string;
  title: string;
  productTitle: string;
  productHandle: string;
  vendor: string;
  availableForSale: boolean;
}

const VARIANTS_BY_SKU = `#graphql
  query VariantsBySku($query: String!, $first: Int!) {
    productVariants(first: $first, query: $query) {
      nodes {
        id
        sku
        title
        availableForSale
        product { title handle vendor status }
      }
    }
  }`;

interface VariantsBySkuData {
  productVariants: {
    nodes: Array<{
      id: string;
      sku: string | null;
      title: string;
      availableForSale: boolean;
      product: { title: string; handle: string; vendor: string; status: string };
    }>;
  };
}

/**
 * Resolves SKUs to variants with one search query per batch of SKUs.
 * Search is fuzzy, so results are filtered on an exact SKU match.
 */
export async function findVariantsBySku(
  gateway: AdminGateway,
  skus: string[],
  { activeOnly = true, batchSize = 50 } = {},
): Promise<Map<string, VariantSummary>> {
  const wanted = new Set(skus);
  const found = new Map<string, VariantSummary>();

  for (const batch of chunk([...wanted], batchSize)) {
    const data = await gateway.request<VariantsBySkuData>(VARIANTS_BY_SKU, {
      query: skuSearchQuery(batch),
      first: Math.min(250, batch.length * 2),
    });
    for (const node of data.productVariants.nodes) {
      if (!node.sku || !wanted.has(node.sku) || found.has(node.sku)) continue;
      if (activeOnly && node.product.status !== "ACTIVE") continue;
      found.set(node.sku, {
        id: node.id,
        sku: node.sku,
        title: node.title,
        productTitle: node.product.title,
        productHandle: node.product.handle,
        vendor: node.product.vendor,
        availableForSale: node.availableForSale,
      });
    }
  }
  return found;
}
