import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { APPLICATION_STATUSES, type ApplicationStatus } from "../lib/b2b/wholesale-application";

const STATUS_TONE = {
  PENDING: "warning",
  APPROVED: "success",
  REJECTED: "critical",
} as const;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const requested = new URL(request.url).searchParams.get("status");
  const status = APPLICATION_STATUSES.includes(requested as ApplicationStatus)
    ? (requested as ApplicationStatus)
    : null;

  const applications = await db.wholesaleApplication.findMany({
    where: { shop: session.shop, ...(status ? { status } : {}) },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      companyName: true,
      segment: true,
      countryCode: true,
      email: true,
      status: true,
      createdAt: true,
    },
  });
  return { status, applications };
};

export default function Applications() {
  const { status, applications } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  return (
    <s-page heading="Trade applications">
      <s-section padding="none">
        <s-table>
          <s-stack slot="filters" direction="inline" gap="small-200">
            {[null, ...APPLICATION_STATUSES].map((s) => (
              <s-button
                key={s ?? "ALL"}
                variant={s === status ? "primary" : "secondary"}
                onClick={() => navigate(s ? `?status=${s}` : "?")}
              >
                {s ? s.charAt(0) + s.slice(1).toLowerCase() : "All"}
              </s-button>
            ))}
          </s-stack>
          <s-table-header-row>
            <s-table-header listSlot="primary">Company</s-table-header>
            <s-table-header>Segment</s-table-header>
            <s-table-header>Country</s-table-header>
            <s-table-header>Contact</s-table-header>
            <s-table-header>Received</s-table-header>
            <s-table-header listSlot="secondary">Status</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {applications.map((a) => (
              <s-table-row key={a.id} clickDelegate={`open-${a.id}`}>
                <s-table-cell>
                  <s-link id={`open-${a.id}`} href={`/app/applications/${a.id}`}>
                    {a.companyName}
                  </s-link>
                </s-table-cell>
                <s-table-cell>{a.segment.replace("_", " ")}</s-table-cell>
                <s-table-cell>{a.countryCode}</s-table-cell>
                <s-table-cell>{a.email}</s-table-cell>
                <s-table-cell>{new Date(a.createdAt).toLocaleDateString()}</s-table-cell>
                <s-table-cell>
                  <s-badge tone={STATUS_TONE[a.status as ApplicationStatus]}>
                    {a.status}
                  </s-badge>
                </s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
        {applications.length === 0 && (
          <s-box padding="base">
            <s-paragraph color="subdued">
              No applications yet. Add the “Wholesale application” block to a page of your theme.
            </s-paragraph>
          </s-box>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
