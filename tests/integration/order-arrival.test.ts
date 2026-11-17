import { beforeEach, describe, expect, it } from "vitest";
import { assignPreparer } from "@/server/services/assignments";
import { createSupplierOrder } from "@/server/services/orders";
import { ARRIVAL_OTHER } from "@/lib/compatibility";
import { createAdmin, createCustomer, createPreparerWithLocation, db, resetDb, addRelayPoint } from "../helpers";

describe("Déclarer une commande : fournisseur et lieu d'arrivée", () => {
  beforeEach(resetDb);

  it("Whatnot pour le stock, « Autre » précisé pour le stock et le dropshipping, autre point d'arrivée visible du préparateur", async () => {
    const admin = await createAdmin();
    const prep = await createPreparerWithLocation(admin);
    const client = await createCustomer({ plan: "PRO" });
    await assignPreparer(admin, { customerId: client.customerId, preparerId: prep.preparer.id });
    const [whatnot, other] = await Promise.all([
      db.supplier.findUniqueOrThrow({ where: { code: "WHATNOT" } }),
      db.supplier.findUniqueOrThrow({ where: { code: "OTHER" } }),
    ]);
    expect(whatnot.orderModes).toEqual(["STOCK"]);
    expect(other.orderModes).toEqual(["STOCK", "DROPSHIP"]);

    const relay = await addRelayPoint(admin, prep.preparer.id);
    const w = await createSupplierOrder(client.actor, { supplierId: whatnot.id, locationId: relay.id, description: "Carte Pokémon", quantity: 1, arrivalNote: "Casier 12" });
    expect(w).toMatchObject({ arrivalOther: false, arrivalNote: "Casier 12", locationId: relay.id });

    // Autre point : précision obligatoire, rattaché au point principal du préparateur.
    const base = { supplierId: other.id, supplierLabel: "Leboncoin", locationId: ARRIVAL_OTHER, description: "Lampe vintage", quantity: 1, compatibilityConfirmed: true };
    await expect(createSupplierOrder(client.actor, base)).rejects.toMatchObject({ code: "ARRIVAL" });
    const o = await createSupplierOrder(client.actor, { ...base, arrivalNote: "Relais Colis Tabac du Centre, 3 rue Victor Hugo, 69002 Lyon" });
    expect(o).toMatchObject({ arrivalOther: true, supplierLabel: "Leboncoin", locationId: prep.location.id, preparerId: prep.preparer.id });
    const notif = await db.notification.findFirstOrThrow({ where: { userId: prep.actor.userId, type: "ORDER_CREATED" }, orderBy: { createdAt: "desc" } });
    expect(notif.body).toContain("à un autre point : Relais Colis Tabac du Centre");

    // « Autre » en dropshipping.
    const d = await createSupplierOrder(client.actor, {
      ...base,
      mode: "DROPSHIP",
      supplierLabel: "Une boutique en ligne",
      locationId: relay.id,
      buyerName: "Acheteuse",
      buyerAddressLine1: "1 rue A",
      buyerPostalCode: "75001",
      buyerCity: "Paris",
    });
    expect(d).toMatchObject({ mode: "DROPSHIP", supplierLabel: "Une boutique en ligne", arrivalOther: false });
  });
});
