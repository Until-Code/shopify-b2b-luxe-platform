import db from "../../db.server";
import { getErpClient } from "../erp/index.server";
import { processOutbox, type OutboxRepository } from "./order-export";

export const prismaOutboxRepository: OutboxRepository = {
  due: (limit, now) =>
    db.outboxEvent.findMany({
      where: { status: "PENDING", nextAttemptAt: { lte: now } },
      orderBy: { nextAttemptAt: "asc" },
      take: limit,
      select: { id: true, aggregateId: true, payload: true, attempts: true },
    }),
  markSent: async (id) => {
    await db.outboxEvent.update({
      where: { id },
      data: { status: "SENT", attempts: { increment: 1 }, lastError: null },
    });
  },
  markFailed: async (id, { attempts, nextAttemptAt, error, dead }) => {
    await db.outboxEvent.update({
      where: { id },
      data: { attempts, nextAttemptAt, lastError: error.slice(0, 1000), status: dead ? "DEAD" : "PENDING" },
    });
  },
};

/** Delivers due outbox events to the ERP. Called by cron and from the dashboard. */
export function runOutbox(limit?: number) {
  return processOutbox(prismaOutboxRepository, getErpClient(), { limit });
}

/** Records the event in the outbox. Duplicate deliveries hit the unique key and are ignored. */
export async function enqueue(shop: string, topic: string, aggregateId: string, payload: unknown) {
  await db.outboxEvent.upsert({
    where: { shop_topic_aggregateId: { shop, topic, aggregateId } },
    create: { shop, topic, aggregateId, payload: JSON.stringify(payload) },
    update: {},
  });
}

/**
 * Returns false when this webhook delivery was already handled.
 * Shopify guarantees at-least-once delivery, identified by X-Shopify-Webhook-Id.
 */
export async function markWebhookProcessed(webhookId: string, shop: string, topic: string) {
  try {
    await db.processedWebhook.create({ data: { webhookId, shop, topic } });
    return true;
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") return false;
    throw error;
  }
}
