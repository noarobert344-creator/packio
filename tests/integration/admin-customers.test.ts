import { beforeEach, describe, expect, it } from "vitest";
import { countCustomersByView, listCustomersForAdmin } from "@/server/queries/admin-people";
import { getAdminOverview } from "@/server/services/stats";
import { createCustomer, db, resetDb } from "../helpers";

describe("Admin → Clients : seuls les vrais clients actifs par défaut", () => {
  beforeEach(resetDb);

  it("les inscrits sans paiement, en retard ou résiliés sont dans leurs onglets ; nouveaux clients = premier paiement", async () => {
    const paid = await createCustomer();
    const unpaid = await createCustomer({ subscribe: false });
    const late = await createCustomer();
    await db.customerProfile.update({ where: { id: late.customerId }, data: { status: "PAST_DUE" } });
    const gone = await createCustomer();
    await db.customerProfile.update({ where: { id: gone.customerId }, data: { status: "CANCELED" } });

    const ids = async (view: Parameters<typeof listCustomersForAdmin>[0]["view"]) => (await listCustomersForAdmin({ view, page: 1 })).rows.map((r) => r.id).sort();
    expect(await ids("actifs")).toEqual([paid.customerId]);
    expect(await ids("sans-paiement")).toEqual([unpaid.customerId]);
    expect(await ids("retard")).toEqual([late.customerId]);
    expect(await ids("anciens")).toEqual([gone.customerId]);
    expect(await ids("tous")).toHaveLength(4);
    expect(await countCustomersByView()).toEqual({ actifs: 1, retard: 1, "sans-paiement": 1, anciens: 1, tous: 4 });

    // Tableau de bord : 3 clients ont payé ce mois-ci, l'inscrit sans paiement ne compte pas.
    expect((await getAdminOverview()).newCustomers).toBe(3);
    const nextMonth = new Date();
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    expect((await getAdminOverview(nextMonth)).newCustomers).toBe(0);
  });
});
