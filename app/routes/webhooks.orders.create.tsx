import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import {
  ORDER_EXPORT_TOPIC,
  isB2bOrder,
  mapOrderToErp,
  type OrderWebhookPayload,
} from "../lib/b2b/order-export";
import { enqueue, markWebhookProcessed } from "../lib/b2b/outbox.server";

/**
 * Keep webhook handlers fast (< 5 s): validate, persist to the outbox, return 200.
 * Delivery to the ERP happens asynchronously in runOutbox().
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload, webhookId } = await authenticate.webhook(request);
  const order = payload as OrderWebhookPayload;

  if (!isB2bOrder(order)) return new Response();
  if (!(await markWebhookProcessed(webhookId, shop, topic))) return new Response();

  await enqueue(shop, ORDER_EXPORT_TOPIC, order.admin_graphql_api_id, mapOrderToErp(order));
  return new Response();
};
