import { assertNoUserErrors, type AdminGateway, type UserError } from "../shopify/admin-gateway";
import { DEMO_CATALOG } from "./demo-catalog";
import { METAFIELDS } from "./metafields";

const DEFINITIONS = `#graphql
  query B2bMetafieldDefinitions($ownerType: MetafieldOwnerType!) {
    metafieldDefinitions(first: 50, ownerType: $ownerType, namespace: "b2b") {
      nodes { key }
    }
  }`;

const DEFINITION_CREATE = `#graphql
  mutation B2bMetafieldDefinitionCreate($definition: MetafieldDefinitionInput!) {
    metafieldDefinitionCreate(definition: $definition) {
      createdDefinition { id }
      userErrors { field message code }
    }
  }`;

/** Creates the metafield definitions of the B2B data contract (idempotent). */
export async function ensureMetafieldDefinitions(gateway: AdminGateway): Promise<string[]> {
  const created: string[] = [];
  for (const def of Object.values(METAFIELDS)) {
    const existing = await gateway.request<{ metafieldDefinitions: { nodes: { key: string }[] } }>(
      DEFINITIONS,
      { ownerType: def.ownerType },
    );
    if (existing.metafieldDefinitions.nodes.some((n) => n.key === def.key)) continue;

    const data = await gateway.request<{ metafieldDefinitionCreate: { userErrors: UserError[] } }>(
      DEFINITION_CREATE,
      {
        definition: {
          ownerType: def.ownerType,
          namespace: def.namespace,
          key: def.key,
          type: def.type,
          name: def.name,
          description: def.description,
          pin: true,
        },
      },
    );
    assertNoUserErrors("metafieldDefinitionCreate", data.metafieldDefinitionCreate);
    created.push(`${def.ownerType}.${def.namespace}.${def.key}`);
  }
  return created;
}

const PRODUCT_SET = `#graphql
  mutation DemoProductSet($identifier: ProductSetIdentifiers!, $input: ProductSetInput!) {
    productSet(identifier: $identifier, input: $input, synchronous: true) {
      product { id }
      userErrors { field message code }
    }
  }`;

const ONLINE_STORE_PUBLICATION = `#graphql
  query OnlineStorePublication {
    publications(first: 20) { nodes { id name } }
  }`;

const PUBLISH = `#graphql
  mutation DemoPublish($id: ID!, $publicationId: ID!) {
    publishablePublish(id: $id, input: [{ publicationId: $publicationId }]) {
      userErrors { field message }
    }
  }`;

/** Upserts the demo catalogue (by handle) and publishes it to the Online Store. */
export async function seedDemoCatalog(gateway: AdminGateway): Promise<number> {
  const { publications } = await gateway.request<{ publications: { nodes: { id: string; name: string }[] } }>(
    ONLINE_STORE_PUBLICATION,
  );
  const onlineStore = publications.nodes.find((p) => p.name === "Online Store");

  for (const product of DEMO_CATALOG) {
    const data = await gateway.request<{
      productSet: { product: { id: string } | null; userErrors: UserError[] };
    }>(PRODUCT_SET, {
      identifier: { handle: product.handle },
      input: {
        handle: product.handle,
        title: product.title,
        vendor: product.vendor,
        productType: product.productType,
        descriptionHtml: product.descriptionHtml,
        status: "ACTIVE",
        tags: ["b2b-demo"],
        productOptions: [
          { name: product.optionName, values: product.variants.map((v) => ({ name: v.option })) },
        ],
        variants: product.variants.map((v) => ({
          optionValues: [{ optionName: product.optionName, name: v.option }],
          sku: v.sku,
          price: v.retailPrice,
          inventoryPolicy: "CONTINUE",
        })),
        metafields: [
          {
            namespace: METAFIELDS.casePack.namespace,
            key: METAFIELDS.casePack.key,
            type: METAFIELDS.casePack.type,
            value: String(product.casePack),
          },
        ],
      },
    });
    const { product: created } = assertNoUserErrors("productSet", data.productSet);

    if (onlineStore && created) {
      const published = await gateway.request<{ publishablePublish: { userErrors: UserError[] } }>(PUBLISH, {
        id: created.id,
        publicationId: onlineStore.id,
      });
      assertNoUserErrors("publishablePublish", published.publishablePublish);
    }
  }
  return DEMO_CATALOG.length;
}

const CATALOG_CREATE = `#graphql
  mutation WholesaleCatalogCreate($input: CatalogCreateInput!) {
    catalogCreate(input: $input) {
      catalog { id title }
      userErrors { field message code }
    }
  }`;

const PRICE_LIST_CREATE = `#graphql
  mutation WholesalePriceListCreate($input: PriceListCreateInput!) {
    priceListCreate(input: $input) {
      priceList { id name currency }
      userErrors { field message code }
    }
  }`;

/**
 * Creates a B2B catalog with its price list. The price list defaults to
 * retail -50% until the first ERP sync overrides it with fixed prices.
 */
export async function createWholesaleCatalog(
  gateway: AdminGateway,
  { title, currency }: { title: string; currency: string },
) {
  const catalogData = await gateway.request<{
    catalogCreate: { catalog: { id: string; title: string } | null; userErrors: UserError[] };
  }>(CATALOG_CREATE, {
    input: { title, status: "ACTIVE", context: { companyLocationIds: [] } },
  });
  const catalog = assertNoUserErrors("catalogCreate", catalogData.catalogCreate).catalog!;

  const priceListData = await gateway.request<{
    priceListCreate: { priceList: { id: string } | null; userErrors: UserError[] };
  }>(PRICE_LIST_CREATE, {
    input: {
      name: `${title} (${currency})`,
      currency,
      catalogId: catalog.id,
      parent: { adjustment: { type: "PERCENTAGE_DECREASE", value: 50 } },
    },
  });
  const priceList = assertNoUserErrors("priceListCreate", priceListData.priceListCreate).priceList!;
  return { catalogId: catalog.id, priceListId: priceList.id };
}
