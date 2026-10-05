/**
 * Demo catalogue for a (fictional) outdoor equipment company with two brands.
 * Seeded into a development store from the dashboard, its SKUs match the mock
 * ERP price lists in app/lib/erp/fixtures.
 */
export interface DemoVariant {
  sku: string;
  option: string;
  retailPrice: string;
}

export interface DemoProduct {
  handle: string;
  title: string;
  vendor: string;
  productType: string;
  optionName: string;
  /** Units per shipping case; enforced in checkout by the b2b-order-rules Function. */
  casePack: number;
  descriptionHtml: string;
  variants: DemoVariant[];
}

export const DEMO_BRANDS = ["Northpeak", "Trailborn"] as const;

export const DEMO_CATALOG: DemoProduct[] = [
  {
    handle: "ridge-hiking-backpack",
    title: "Ridge Hiking Backpack",
    vendor: "Northpeak",
    productType: "Backpacks",
    optionName: "Volume",
    casePack: 4,
    descriptionHtml:
      "<p>Ventilated back panel, hip-belt pockets and integrated rain cover.</p>",
    variants: [
      { sku: "NP-RDG-28", option: "28 L", retailPrice: "129.00" },
      { sku: "NP-RDG-40", option: "40 L", retailPrice: "159.00" },
    ],
  },
  {
    handle: "alpine-trekking-poles",
    title: "Alpine Trekking Poles",
    vendor: "Northpeak",
    productType: "Trekking poles",
    optionName: "Material",
    casePack: 6,
    descriptionHtml: "<p>Three-section telescopic poles with cork grips, sold by pair.</p>",
    variants: [
      { sku: "NP-ATP-ALU", option: "Aluminium", retailPrice: "89.00" },
      { sku: "NP-ATP-CRB", option: "Carbon", retailPrice: "139.00" },
    ],
  },
  {
    handle: "basecamp-2p-tent",
    title: "Basecamp 2P Tent",
    vendor: "Northpeak",
    productType: "Tents",
    optionName: "Capacity",
    casePack: 2,
    descriptionHtml: "<p>Freestanding three-season tent, 2.1 kg, two doors and vestibules.</p>",
    variants: [{ sku: "NP-BC2P", option: "2 persons", retailPrice: "299.00" }],
  },
  {
    handle: "merino-base-layer-top",
    title: "Merino Base Layer Top",
    vendor: "Trailborn",
    productType: "Base layers",
    optionName: "Size",
    casePack: 6,
    descriptionHtml: "<p>Odour-resistant 200 g/m² merino wool, flatlock seams.</p>",
    variants: [{ sku: "TB-MBL-M", option: "M", retailPrice: "79.00" }],
  },
  {
    handle: "trail-running-shoes",
    title: "Trail Running Shoes",
    vendor: "Trailborn",
    productType: "Footwear",
    optionName: "Size",
    casePack: 6,
    descriptionHtml: "<p>5 mm lugs, rock plate and quick-lace system.</p>",
    variants: [{ sku: "TB-TRS-42", option: "EU 42", retailPrice: "139.00" }],
  },
  {
    handle: "trail-starter-kit",
    title: "Trail Starter Kit",
    vendor: "Trailborn",
    productType: "Accessories",
    optionName: "Format",
    casePack: 3,
    descriptionHtml: "<p>Running cap, neck gaiter and two pairs of trail socks.</p>",
    variants: [{ sku: "TB-STK-SET", option: "Kit", retailPrice: "59.00" }],
  },
];
