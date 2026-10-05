import type {
  CartValidationsGenerateRunInput,
  CartValidationsGenerateRunResult,
  ValidationError,
} from "../generated/api";
import { translate, type Locale } from "./messages";

type Input = CartValidationsGenerateRunInput;
type Line = Input["cart"]["lines"][number];

const CART = "$.cart";

/**
 * B2B business rules enforced server-side by Shopify, whatever the channel
 * (Online Store, headless storefront, draft orders converted at checkout):
 *
 *  1. Brand authorization — a retailer can only order the brands of its
 *     distribution agreement (company metafield b2b.authorized_brands).
 *  2. Case packs — quantities must be a multiple of the product case pack
 *     (product metafield b2b.case_pack).
 *  3. Minimum order value per company location (b2b.minimum_order_amount),
 *     only checked once the buyer reaches checkout so the cart stays editable.
 *
 * Retail (D2C) buyers are never affected.
 */
export function cartValidationsGenerateRun(input: Input): CartValidationsGenerateRunResult {
  const purchasingCompany = input.cart.buyerIdentity?.purchasingCompany;
  if (!purchasingCompany) return result([]);

  const locale: Locale = input.localization.language.isoCode === "FR" ? "fr" : "en";
  const t = (key: Parameters<typeof translate>[1], vars: Record<string, string | number>) =>
    translate(locale, key, vars);

  const errors: ValidationError[] = [];
  const brands = authorizedBrands(purchasingCompany.company.authorizedBrands?.jsonValue);

  for (const line of input.cart.lines) {
    const variant = asVariant(line);
    if (!variant) continue;
    const { product } = variant;

    if (brands && product.vendor && !brands.has(normalize(product.vendor))) {
      errors.push({
        message: t("brandNotAuthorized", { product: product.title, brand: product.vendor }),
        target: CART,
      });
    }

    const casePack = Number(product.casePack?.value ?? 1);
    if (Number.isInteger(casePack) && casePack > 1 && line.quantity % casePack !== 0) {
      errors.push({
        message: t("casePack", { product: product.title, casePack }),
        target: CART,
      });
    }
  }

  const step = input.buyerJourney.step;
  const atCheckout = step === "CHECKOUT_INTERACTION" || step === "CHECKOUT_COMPLETION";
  const minimumInShopCurrency = Number(purchasingCompany.location.minimumOrderAmount?.value);

  if (atCheckout && minimumInShopCurrency > 0) {
    const { amount, currencyCode } = input.cart.cost.subtotalAmount;
    const minimum = minimumInShopCurrency * Number(input.presentmentCurrencyRate || 1);
    const subtotal = Number(amount);
    if (subtotal < minimum) {
      errors.push({
        message: t("minimumOrder", {
          location: purchasingCompany.location.name,
          minimum: formatMoney(minimum, currencyCode, locale),
          missing: formatMoney(minimum - subtotal, currencyCode, locale),
        }),
        target: CART,
      });
    }
  }

  return result(errors);
}

function result(errors: ValidationError[]): CartValidationsGenerateRunResult {
  return { operations: [{ validationAdd: { errors } }] };
}

function asVariant(line: Line) {
  return line.merchandise.__typename === "ProductVariant" ? line.merchandise : null;
}

const normalize = (value: string) => value.trim().toLocaleLowerCase();

/** `null` means "no restriction" (metafield missing or empty). */
function authorizedBrands(value: unknown): Set<string> | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  return new Set(value.filter((v): v is string => typeof v === "string").map(normalize));
}

function formatMoney(amount: number, currency: string, locale: Locale) {
  const fixed = (Math.ceil(amount * 100) / 100).toFixed(2);
  return locale === "fr" ? `${fixed.replace(".", ",")} ${currency}` : `${currency} ${fixed}`;
}
