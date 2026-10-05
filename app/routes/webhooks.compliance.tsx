import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

/**
 * Privacy compliance webhooks. The app stores personal data only in
 * WholesaleApplication rows (trade contacts), which are deleted on request.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  switch (topic) {
    case "CUSTOMERS_DATA_REQUEST":
      // Data is exported manually by the merchant from the Applications page.
      break;
    case "CUSTOMERS_REDACT": {
      const email = (payload as { customer?: { email?: string } }).customer?.email;
      if (email) {
        await db.wholesaleApplication.deleteMany({ where: { shop, email: email.toLowerCase() } });
      }
      break;
    }
    case "SHOP_REDACT":
      await db.$transaction([
        db.wholesaleApplication.deleteMany({ where: { shop } }),
        db.outboxEvent.deleteMany({ where: { shop } }),
        db.syncJob.deleteMany({ where: { shop } }),
        db.processedWebhook.deleteMany({ where: { shop } }),
      ]);
      break;
  }
  return new Response();
};
