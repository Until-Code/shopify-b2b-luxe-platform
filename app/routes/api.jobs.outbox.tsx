import { timingSafeEqual } from "node:crypto";
import type { ActionFunctionArgs } from "react-router";
import { runOutbox } from "../lib/b2b/outbox.server";

function isAuthorized(request: Request) {
  const secret = process.env.JOBS_SECRET;
  const header = request.headers.get("Authorization") ?? "";
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(header);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

/**
 * Cron entry point (e.g. scheduled GitHub Action, Fly/Render cron, Cloud Scheduler):
 *   curl -X POST -H "Authorization: Bearer $JOBS_SECRET" $APP_URL/api/jobs/outbox
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  if (!isAuthorized(request)) return new Response("Unauthorized", { status: 401 });
  return Response.json(await runOutbox(100));
};
