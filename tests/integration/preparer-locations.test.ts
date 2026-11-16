import { beforeEach, describe, expect, it } from "vitest";
import { toActor } from "@/server/auth/session-store";
import { assignPreparer } from "@/server/services/assignments";
import { createSupplierOrder } from "@/server/services/orders";
import { deactivateLocation, enableAdminPreparerProfile, saveLocation, setPrimaryLocation, syncLocationContact } from "@/server/services/preparers";
import { createAdmin, createCustomer, createPreparerWithLocation, db, resetDb } from "../helpers";

const locker = (preparerId: string) => ({
  preparerId,
  type: "LOCKER" as const,
  label: "Locker secondaire",
  network: "MONDIAL_RELAY",
  relayName: "Locker Mondial Relay Gare Part-Dieu",
  addressLine1: "5 place Charles Béraudier",
  postalCode: "69003",
  city: "Lyon",
  country: "FR",
  recipientName: "Paul P.",
  recipientPhone: "0600000001",
});

describe("Points de réception modifiables par le préparateur (Paramètres)", () => {
  beforeEach(resetDb);

  it("modifier le nom ou le téléphone garde la validation ; changer l'endroit la retire", async () => {
    const admin = await createAdmin();
    const prep = await createPreparerWithLocation(admin, { locationType: "LOCKER" });
    const { location } = prep;
    expect(location.validatedAt).not.toBeNull();
    const base = { ...location, preparerId: prep.preparer.id, locationId: location.id, type: "LOCKER" as const };

    const renamed = await saveLocation(prep.actor, { ...base, label: "Mon locker", recipientPhone: "0611111111", openingHours: "24 h/24" });
    expect(renamed).toMatchObject({ label: "Mon locker", recipientPhone: "0611111111", isPrimary: true, isActive: true });
    expect(renamed.validatedAt).not.toBeNull();

    const moved = await saveLocation(prep.actor, { ...base, relayName: "InPost Lyon Brotteaux 02", addressLine1: "2 place Jules Ferry", postalCode: "69006" });
    expect(moved).toMatchObject({ relayName: "InPost Lyon Brotteaux 02", isPrimary: true, validatedAt: null, validatedById: null });
    const alert = await db.notification.findFirst({ where: { userId: admin.userId, type: "ADMIN_PREPARER_ONBOARDED" } });
    expect(alert?.title).toBe("Point de réception modifié à valider");

    // Un autre préparateur ne peut pas toucher à ce point.
    const other = await createPreparerWithLocation(admin, { locationType: "LOCKER" });
    await expect(saveLocation(other.actor, { ...base, preparerId: other.preparer.id })).rejects.toThrow();
    await expect(deactivateLocation(other.actor, location.id)).rejects.toThrow();
  });

  it("pas de changement d'adresse tant qu'une commande y est attendue", async () => {
    const admin = await createAdmin();
    const prep = await createPreparerWithLocation(admin, { locationType: "LOCKER" });
    const client = await createCustomer({ plan: "PRO" });
    await assignPreparer(admin, { customerId: client.customerId, preparerId: prep.preparer.id });
    const vinted = await db.supplier.findUniqueOrThrow({ where: { code: "VINTED" } });
    await createSupplierOrder(client.actor, { supplierId: vinted.id, locationId: prep.location.id, description: "Veste", quantity: 1 });

    const base = { ...prep.location, preparerId: prep.preparer.id, locationId: prep.location.id, type: "LOCKER" as const };
    await expect(saveLocation(prep.actor, { ...base, addressLine1: "99 avenue Ailleurs" })).rejects.toMatchObject({ code: "IN_TRANSIT" });
    // Le libellé et le téléphone restent modifiables.
    await expect(saveLocation(prep.actor, { ...base, label: "Locker du quartier", recipientPhone: "0622222222" })).resolves.toMatchObject({ label: "Locker du quartier" });
  });

  it("retirer un point : jamais le dernier, et le principal passe au suivant", async () => {
    const admin = await createAdmin();
    const prep = await createPreparerWithLocation(admin, { locationType: "LOCKER" });
    await expect(deactivateLocation(prep.actor, prep.location.id)).rejects.toMatchObject({ code: "LAST_POINT" });

    const second = await saveLocation(prep.actor, { ...locker(prep.preparer.id), isPrimary: false });
    expect(second).toMatchObject({ isPrimary: false, validatedAt: null });
    await deactivateLocation(prep.actor, prep.location.id);
    expect(await db.preparerLocation.findUniqueOrThrow({ where: { id: prep.location.id } })).toMatchObject({ isActive: false, isPrimary: false });
    expect(await db.preparerLocation.findUniqueOrThrow({ where: { id: second.id } })).toMatchObject({ isActive: true, isPrimary: true });
    await expect(saveLocation(prep.actor, { ...prep.location, preparerId: prep.preparer.id, locationId: prep.location.id, type: "LOCKER" })).rejects.toMatchObject({
      code: "INACTIVE",
    });
  });

  it("choisir le point principal", async () => {
    const admin = await createAdmin();
    const prep = await createPreparerWithLocation(admin, { locationType: "LOCKER" });
    const second = await saveLocation(prep.actor, { ...locker(prep.preparer.id), isPrimary: false });
    await setPrimaryLocation(prep.actor, second.id);
    const rows = await db.preparerLocation.findMany({ where: { preparerId: prep.preparer.id }, select: { id: true, isPrimary: true } });
    expect(rows.filter((r) => r.isPrimary).map((r) => r.id)).toEqual([second.id]);
  });

  it("un administrateur-préparateur n'attend pas sa propre validation", async () => {
    const admin = await createAdmin();
    const profile = await enableAdminPreparerProfile(admin);
    const user = await db.user.findUniqueOrThrow({ where: { id: admin.userId }, include: { staffRole: true, customerProfile: { select: { id: true } }, preparerProfile: { select: { id: true } } } });
    const asPreparer = toActor(user, "PREPARER");
    expect(asPreparer.permissions).toEqual([]);
    const point = await saveLocation(asPreparer, { ...locker(profile.id), isPrimary: true });
    expect(point.validatedAt).not.toBeNull();
    expect(point.validatedById).toBe(admin.userId);
  });

  it("nouveau nom ou numéro dans le profil : reporté sur les points de réception", async () => {
    const admin = await createAdmin();
    const prep = await createPreparerWithLocation(admin, { locationType: "LOCKER" });
    await db.preparerLocation.update({ where: { id: prep.location.id }, data: { recipientPhone: "0600000001" } });
    await syncLocationContact(prep.preparer.id, { name: "Paul P.", phone: "0600000001" }, { name: "Paul Martin", phone: "0699999999" });
    expect(await db.preparerLocation.findUniqueOrThrow({ where: { id: prep.location.id } })).toMatchObject({
      recipientName: "Paul Martin",
      recipientPhone: "0699999999",
      isActive: true,
    });
  });
});
