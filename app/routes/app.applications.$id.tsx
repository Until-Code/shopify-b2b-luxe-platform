import { useEffect } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, redirect, useActionData, useLoaderData, useNavigation } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";
import { adminContext } from "../lib/shopify/context.server";
import { onboardCompany } from "../lib/b2b/company-onboarding";

const APPROVAL_OPTIONS = `#graphql
  query ApprovalOptions {
    catalogs(first: 50, type: COMPANY_LOCATION) {
      nodes { id title status priceList { currency } }
    }
    paymentTermsTemplates { id name paymentTermsType dueInDays }
    shop { currencyCode }
    shopVendors: productVendors(first: 50) { nodes }
  }`;

interface ApprovalOptions {
  catalogs: { nodes: { id: string; title: string; status: string; priceList: { currency: string } | null }[] };
  paymentTermsTemplates: { id: string; name: string; paymentTermsType: string; dueInDays: number | null }[];
  shop: { currencyCode: string };
  shopVendors: { nodes: string[] };
}

async function findApplication(shop: string, id: string | undefined) {
  const application = await db.wholesaleApplication.findFirst({ where: { id, shop } });
  if (!application) throw new Response("Not found", { status: 404 });
  return application;
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { gateway, session } = await adminContext(request);
  const application = await findApplication(session.shop, params.id);
  const options =
    application.status === "PENDING"
      ? await gateway.request<ApprovalOptions>(APPROVAL_OPTIONS)
      : null;
  return { application, options };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { gateway, session } = await adminContext(request);
  const application = await findApplication(session.shop, params.id);
  if (application.status !== "PENDING") return { error: "Application already reviewed" };

  const form = await request.formData();
  const reviewedBy = session.onlineAccessInfo?.associated_user?.email ?? session.shop;

  if (form.get("intent") === "reject") {
    await db.wholesaleApplication.update({
      where: { id: application.id },
      data: {
        status: "REJECTED",
        rejectionReason: String(form.get("reason") ?? "").slice(0, 500) || null,
        reviewedBy,
        reviewedAt: new Date(),
      },
    });
    return redirect("/app/applications");
  }

  const catalogId = String(form.get("catalogId") ?? "");
  const minimumOrderAmount = String(form.get("minimumOrderAmount") ?? "").trim();
  if (!catalogId) return { error: "Select a catalog" };
  if (minimumOrderAmount && !/^\d+(\.\d{1,2})?$/.test(minimumOrderAmount)) {
    return { error: "Minimum order amount must be a number" };
  }

  try {
    const { companyId } = await onboardCompany({
      gateway,
      application,
      decision: {
        catalogId,
        paymentTermsTemplateId: String(form.get("paymentTermsTemplateId") ?? "") || null,
        authorizedBrands: form.getAll("brands").map(String),
        minimumOrderAmount: minimumOrderAmount || null,
      },
      onCompanyCreated: async (shopifyCompanyId) => {
        await db.wholesaleApplication.update({
          where: { id: application.id },
          data: { shopifyCompanyId },
        });
      },
    });
    await db.wholesaleApplication.update({
      where: { id: application.id },
      data: { status: "APPROVED", shopifyCompanyId: companyId, reviewedBy, reviewedAt: new Date() },
    });
    return { approved: true, companyId };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
};

export default function ApplicationDetail() {
  const { application: a, options } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const navigation = useNavigation();
  const shopify = useAppBridge();
  const submitting = navigation.state === "submitting";

  useEffect(() => {
    if (result && "approved" in result) shopify.toast.show("Company created in Shopify");
  }, [result, shopify]);

  return (
    <s-page heading={a.companyName}>
      <s-link slot="breadcrumb-actions" href="/app/applications">
        Trade applications
      </s-link>

      {result && "error" in result && (
        <s-banner tone="critical" heading="Action failed">
          {result.error}
          {a.shopifyCompanyId && " — the company already exists; approving again resumes the onboarding."}
        </s-banner>
      )}

      <s-section heading="Application">
        <s-grid gridTemplateColumns="1fr 1fr" gap="base">
          <Field label="Segment" value={a.segment.replace("_", " ")} />
          <Field label="VAT number" value={a.vatNumber} />
          <Field label="Contact" value={`${a.contactFirstName} ${a.contactLastName}`} />
          <Field label="Email" value={a.email} />
          <Field label="Phone" value={a.phone} />
          <Field label="Website" value={a.website} />
          <Field label="Address" value={`${a.address1}, ${a.zip} ${a.city}, ${a.countryCode}`} />
          <Field label="Language" value={a.locale.toUpperCase()} />
        </s-grid>
        {a.message && (
          <s-box paddingBlockStart="base">
            <s-text color="subdued">Message</s-text>
            <s-paragraph>{a.message}</s-paragraph>
          </s-box>
        )}
      </s-section>

      {a.status !== "PENDING" && (
        <s-section heading="Decision">
          <s-paragraph>
            <s-badge tone={a.status === "APPROVED" ? "success" : "critical"}>{a.status}</s-badge>{" "}
            by {a.reviewedBy} on {a.reviewedAt ? new Date(a.reviewedAt).toLocaleString() : "—"}
          </s-paragraph>
          {a.rejectionReason && <s-paragraph>Reason: {a.rejectionReason}</s-paragraph>}
          {a.shopifyCompanyId && (
            <s-button
              onClick={() =>
                shopify.intents.invoke?.("edit:shopify/Company", { value: a.shopifyCompanyId! })
              }
            >
              Open company in Shopify
            </s-button>
          )}
        </s-section>
      )}

      {options && (
        <>
          <s-section heading="Approve">
            <Form method="post">
              <input type="hidden" name="intent" value="approve" />
              <s-stack direction="block" gap="base">
                <s-select label="Catalog (assortment and price list)" name="catalogId" required>
                  <s-option value="">Select a catalog</s-option>
                  {options.catalogs.nodes.map((c) => (
                    <s-option key={c.id} value={c.id}>
                      {c.title} {c.priceList ? `(${c.priceList.currency})` : ""}
                    </s-option>
                  ))}
                </s-select>
                <s-select label="Payment terms" name="paymentTermsTemplateId">
                  <s-option value="">Pay at checkout</s-option>
                  {options.paymentTermsTemplates
                    .filter((t) => t.paymentTermsType === "NET")
                    .map((t) => (
                      <s-option key={t.id} value={t.id}>
                        {t.name}
                      </s-option>
                    ))}
                </s-select>
                <s-choice-list label="Authorized brands (distribution agreement)" name="brands" multiple>
                  {options.shopVendors.nodes.map((vendor) => (
                    <s-choice key={vendor} value={vendor} selected>
                      {vendor}
                    </s-choice>
                  ))}
                </s-choice-list>
                <s-text-field
                  label={`Minimum order amount (${options.shop.currencyCode})`}
                  name="minimumOrderAmount"
                  placeholder="1500"
                />
                <s-button type="submit" variant="primary" {...(submitting ? { loading: true } : {})}>
                  Approve and create company
                </s-button>
              </s-stack>
            </Form>
          </s-section>

          <s-section heading="Reject">
            <Form method="post">
              <input type="hidden" name="intent" value="reject" />
              <s-stack direction="block" gap="base">
                <s-text-area label="Internal reason" name="reason" rows={2} />
                <s-button type="submit" tone="critical">
                  Reject application
                </s-button>
              </s-stack>
            </Form>
          </s-section>
        </>
      )}
    </s-page>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <s-stack direction="block" gap="small-300">
      <s-text color="subdued">{label}</s-text>
      <s-text>{value || "—"}</s-text>
    </s-stack>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
