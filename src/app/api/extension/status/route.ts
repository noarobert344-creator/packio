import { db } from "@/server/db";
import { authenticate, errorResponse, json, preflight } from "@/server/extension-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS(request: Request) {
  return preflight(request);
}

/** État du compte Packio vu par l'extension (test de connexion). */
export async function GET(request: Request) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;
  try {
    const customer = await db.customerProfile.findUniqueOrThrow({
      where: { id: auth.customerId },
      select: {
        referenceCode: true,
        currentPreparerId: true,
        user: { select: { firstName: true } },
        marketplaceAccounts: { select: { platform: true, username: true, lastSyncAt: true }, orderBy: { lastSyncAt: "desc" } },
      },
    });
    return json(request, {
      ok: true,
      customer: { referenceCode: customer.referenceCode, firstName: customer.user.firstName, hasPreparer: !!customer.currentPreparerId },
      accounts: customer.marketplaceAccounts,
    });
  } catch (err) {
    return errorResponse(request, err);
  }
}
