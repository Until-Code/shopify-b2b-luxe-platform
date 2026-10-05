import { describe, expect, it } from "vitest";
import { cartValidationsGenerateRun } from "../src/cart_validations_generate_run";

type Step = "CART_INTERACTION" | "CHECKOUT_INTERACTION" | "CHECKOUT_COMPLETION";

interface LineSpec {
  title: string;
  vendor: string;
  quantity: number;
  casePack?: number;
}

function buildInput({
  b2b = true,
  step = "CHECKOUT_COMPLETION" as Step,
  language = "EN",
  brands = ["Northpeak", "Trailborn"] as string[] | null,
  minimum = null as string | null,
  subtotal = "1000.00",
  rate = "1.0",
  lines = [] as LineSpec[],
}) {
  return {
    buyerJourney: { step },
    localization: { language: { isoCode: language } },
    presentmentCurrencyRate: rate,
    cart: {
      cost: { subtotalAmount: { amount: subtotal, currencyCode: "EUR" } },
      buyerIdentity: b2b
        ? {
            purchasingCompany: {
              company: {
                name: "Basecamp Outfitters",
                authorizedBrands: brands ? { jsonValue: brands } : null,
              },
              location: {
                name: "Lyon",
                minimumOrderAmount: minimum ? { value: minimum } : null,
              },
            },
          }
        : { purchasingCompany: null },
      lines: lines.map((l) => ({
        quantity: l.quantity,
        merchandise: {
          __typename: "ProductVariant",
          sku: "SKU",
          product: {
            title: l.title,
            vendor: l.vendor,
            casePack: l.casePack ? { value: String(l.casePack) } : null,
          },
        },
      })),
    },
  } as never;
}

const errorsOf = (input: never) =>
  (cartValidationsGenerateRun(input).operations[0] as { validationAdd: { errors: { message: string }[] } })
    .validationAdd.errors.map((e) => e.message);

const poles = { title: "Alpine Trekking Poles", vendor: "Northpeak", casePack: 6 };

describe("b2b-order-rules", () => {
  it("never restricts retail (non-B2B) buyers", () => {
    const input = buildInput({
      b2b: false,
      minimum: "5000",
      lines: [{ ...poles, vendor: "Other brand", quantity: 1 }],
    });
    expect(errorsOf(input)).toEqual([]);
  });

  it("accepts a compliant B2B cart", () => {
    expect(errorsOf(buildInput({ minimum: "500", lines: [{ ...poles, quantity: 12 }] }))).toEqual([]);
  });

  describe("case packs", () => {
    it("rejects quantities that are not a multiple of the case pack", () => {
      expect(errorsOf(buildInput({ lines: [{ ...poles, quantity: 7 }] }))).toEqual([
        "Alpine Trekking Poles is sold by cases of 6. Please order a multiple of 6.",
      ]);
    });

    it("ignores products without case pack", () => {
      expect(errorsOf(buildInput({ lines: [{ ...poles, casePack: undefined, quantity: 7 }] }))).toEqual([]);
    });
  });

  describe("brand authorization", () => {
    it("rejects brands outside the distribution agreement (case-insensitive)", () => {
      const input = buildInput({
        brands: ["northpeak"],
        lines: [
          { ...poles, quantity: 6 },
          { title: "Merino Base Layer Top", vendor: "Trailborn", quantity: 6 },
        ],
      });
      expect(errorsOf(input)).toEqual([
        "Merino Base Layer Top (Trailborn) is not part of your distribution agreement. Please remove it from your order.",
      ]);
    });

    it("does not restrict when no brand list is configured", () => {
      const input = buildInput({ brands: null, lines: [{ ...poles, vendor: "Any", quantity: 6 }] });
      expect(errorsOf(input)).toEqual([]);
    });
  });

  describe("minimum order value", () => {
    it("is enforced at checkout, with the missing amount", () => {
      const input = buildInput({ minimum: "1500", subtotal: "1234.50", lines: [{ ...poles, quantity: 12 }] });
      expect(errorsOf(input)).toEqual([
        "The minimum order for Lyon is EUR 1500.00. Add EUR 265.50 to place your order.",
      ]);
    });

    it("is not enforced while the buyer is still building the cart", () => {
      const input = buildInput({ step: "CART_INTERACTION", minimum: "1500", subtotal: "100.00" });
      expect(errorsOf(input)).toEqual([]);
    });

    it("converts the minimum to the presentment currency", () => {
      // Minimum 1000 in shop currency, rate 1.1 => 1100 in the buyer's currency.
      const input = buildInput({ minimum: "1000", subtotal: "1050.00", rate: "1.1" });
      expect(errorsOf(input)).toHaveLength(1);
      expect(errorsOf(buildInput({ minimum: "1000", subtotal: "1100.00", rate: "1.1" }))).toEqual([]);
    });
  });

  it("speaks French to French buyers", () => {
    const input = buildInput({ language: "FR", minimum: "1500", subtotal: "1000.00" });
    expect(errorsOf(input)).toEqual([
      "Le minimum de commande pour Lyon est de 1500,00 EUR. Ajoutez 500,00 EUR pour valider la commande.",
    ]);
  });
});
