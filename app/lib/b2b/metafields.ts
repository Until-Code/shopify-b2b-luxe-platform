/**
 * Single source of truth for the custom data contract shared by the app,
 * the b2b-order-rules Function and the theme app extension.
 */
export const METAFIELDS = {
  casePack: {
    ownerType: "PRODUCT",
    namespace: "b2b",
    key: "case_pack",
    type: "number_integer",
    name: "Case pack",
    description: "Units per shipping case. B2B quantities must be a multiple of it.",
  },
  authorizedBrands: {
    ownerType: "COMPANY",
    namespace: "b2b",
    key: "authorized_brands",
    type: "list.single_line_text_field",
    name: "Authorized brands",
    description: "Distribution agreement: brands (product vendors) this retailer may order.",
  },
  minimumOrderAmount: {
    ownerType: "COMPANY_LOCATION",
    namespace: "b2b",
    key: "minimum_order_amount",
    type: "number_decimal",
    name: "Minimum order amount",
    description: "Minimum subtotal per order, in the shop currency.",
  },
} as const;

export type MetafieldKey = keyof typeof METAFIELDS;
