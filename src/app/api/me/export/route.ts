import { getActor } from "@/server/auth/current";
import { audit } from "@/server/services/audit";
import { exportCustomerData } from "@/server/services/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Export RGPD des données du client connecté. */
export async function GET() {
  const actor = await getActor();
  if (!actor || actor.role !== "CUSTOMER" || !actor.customerId) return new Response("Non autorisé", { status: 401 });
  const data = await exportCustomerData(actor.customerId);
  await audit({ actor, action: "account.data_export", entityType: "customer", entityId: actor.customerId });
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="packio-mes-donnees-${new Date().toISOString().slice(0, 10)}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
