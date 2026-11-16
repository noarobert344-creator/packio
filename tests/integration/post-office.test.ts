import { beforeEach, describe, expect, it } from "vitest";
import { assignPreparer } from "@/server/services/assignments";
import { createSupplierOrder, customerUpdateOrder } from "@/server/services/orders";
import { saveLocation } from "@/server/services/preparers";
import { checkCompatibility } from "@/lib/compatibility";
import { createAdmin, createCustomer, createPreparerWithLocation, db, resetDb } from "../helpers";

describe("Poste restante : livrer sans jamais passer par le domicile du préparateur", () => {
  beforeEach(resetDb);

  it("ZenMarket accepte la poste restante (pas les lockers) ; Vinted ne l'accepte pas", async () => {
    const admin = await createAdmin();
    const prep = await createPreparerWithLocation(admin, { locationType: "LOCKER" });
    const office = await saveLocation(admin, {
      preparerId: prep.preparer.id,
      type: "POST_OFFICE",
      label: "Poste restante",
      network: null,
      relayName: "Bureau de poste Lyon Bellecour",
      addressLine1: "10 place Antonin Poncet",
      postalCode: "69002",
      city: "Lyon",
      country: "FR",
      recipientName: "Paul P.",
      isPrimary: false,
      validate: true,
    });
    expect(office).toMatchObject({ type: "POST_OFFICE", network: "LA_POSTE" });
    await expect(
      saveLocation(admin, { ...office, preparerId: prep.preparer.id, relayName: "", type: "POST_OFFICE", isPrimary: false, validate: true, locationId: office.id }),
    ).rejects.toMatchObject({ code: "POST_OFFICE" });

    const client = await createCustomer({ plan: "PRO" });
    await assignPreparer(admin, { customerId: client.customerId, preparerId: prep.preparer.id });
    const [zen, vinted] = await Promise.all([db.supplier.findUniqueOrThrow({ where: { code: "ZENMARKET" } }), db.supplier.findUniqueOrThrow({ where: { code: "VINTED" } })]);
    expect(zen.acceptedLocationTypes).toEqual(["POST_OFFICE", "BUSINESS_ADDRESS"]);
    expect(zen.compatibilityNotes).toContain("poste restante");

    const order = await createSupplierOrder(client.actor, { supplierId: zen.id, locationId: office.id, description: "Figurine", quantity: 1 });
    expect(order.locationId).toBe(office.id);
    // Le client signale l'arrivée (sans code au bureau de poste) : le préparateur est prévenu.
    const arrived = await customerUpdateOrder(client.actor, { orderId: order.id, status: "AT_LOCKER" });
    expect(arrived.status).toBe("AT_LOCKER");
    const alert = await db.notification.findFirst({ where: { userId: prep.preparer.userId, type: "PARCEL_AT_LOCKER" } });
    expect(alert?.title).toBe("Colis arrivé : à récupérer");
    expect(alert?.body).toContain("pièce d'identité");
    await customerUpdateOrder(client.actor, { orderId: order.id, pickupCode: "AVIS-4521" });
    expect((await db.supplierOrder.findUniqueOrThrow({ where: { id: order.id } })).pickupCode).toBe("AVIS-4521");
    expect(await db.notification.count({ where: { userId: prep.preparer.userId, type: "PARCEL_AT_LOCKER" } })).toBe(2);
    await expect(createSupplierOrder(client.actor, { supplierId: zen.id, locationId: prep.location.id, description: "Figurine", quantity: 1 })).rejects.toMatchObject({
      code: "INCOMPATIBLE",
    });
    expect(checkCompatibility(vinted, { type: "POST_OFFICE", network: "LA_POSTE" }).ok).toBe(false);

    // Un préparateur ne peut jamais proposer d'adresse : lockers, points relais ou poste restante seulement.
    await expect(
      saveLocation(prep.actor, {
        preparerId: prep.preparer.id,
        type: "BUSINESS_ADDRESS",
        label: "Chez moi",
        network: null,
        relayName: null,
        addressLine1: "3 rue de chez moi",
        postalCode: "69001",
        city: "Lyon",
        country: "FR",
        recipientName: "Paul P.",
        isPrimary: false,
      }),
    ).rejects.toMatchObject({ code: "NO_ADDRESS" });
    for (const code of ["VESTIAIRE", "TEMU", "ALIEXPRESS"]) {
      expect((await db.supplier.findUniqueOrThrow({ where: { code } })).acceptedLocationTypes).toContain("POST_OFFICE");
    }
    expect(checkCompatibility(zen, { type: "POST_OFFICE", network: "LA_POSTE" }).ok).toBe(true);
  });
});
