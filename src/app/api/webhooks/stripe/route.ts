import { processStripeWebhook } from "@/server/billing/webhook-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return processStripeWebhook(request);
}
