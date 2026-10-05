import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { parseApplicationForm } from "../lib/b2b/wholesale-application";
import { AdminGateway } from "../lib/shopify/admin-gateway";
import { findVariantsBySku } from "../lib/shopify/variants";

const MAX_SKUS = 100;

/**
 * GET /apps/wholesale?skus=A,B — quick order SKU lookup (B2B buyers only).
 * Prices are not returned: the cart applies the buyer's contextual B2B price.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.public.appProxy(request);
  if (!admin) return Response.json({ error: "App not installed" }, { status: 503 });

  const url = new URL(request.url);
  // Shopify appends logged_in_customer_id to proxied requests from logged-in buyers.
  if (!url.searchParams.get("logged_in_customer_id")) {
    return Response.json({ error: "Sign in with your trade account" }, { status: 401 });
  }

  const skus = [
    ...new Set(
      (url.searchParams.get("skus") ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ].slice(0, MAX_SKUS);
  if (!skus.length) return Response.json({ variants: [] });

  const found = await findVariantsBySku(new AdminGateway(admin.graphql), skus);
  return Response.json(
    {
      variants: skus.map((sku) => {
        const v = found.get(sku);
        return v
          ? {
              sku,
              found: true,
              variantId: Number(v.id.split("/").pop()),
              title: v.title === "Default Title" ? v.productTitle : `${v.productTitle} — ${v.title}`,
              vendor: v.vendor,
              available: v.availableForSale,
            }
          : { sku, found: false };
      }),
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
};

/** POST /apps/wholesale — trade account application from the storefront. */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.public.appProxy(request);
  if (!session) return Response.json({ ok: false, error: "App not installed" }, { status: 503 });

  const parsed = parseApplicationForm(await request.formData());
  if (!parsed.success) {
    return Response.json(
      { ok: false, errors: parsed.error.flatten().fieldErrors },
      { status: 422 },
    );
  }

  const existing = await db.wholesaleApplication.findUnique({
    where: { shop_email: { shop: session.shop, email: parsed.data.email } },
    select: { status: true },
  });
  if (existing) {
    // Same answer whether the email exists or not: no account enumeration.
    return Response.json({ ok: true });
  }

  await db.wholesaleApplication.create({ data: { shop: session.shop, ...parsed.data } });
  return Response.json({ ok: true }, { status: 201 });
};
