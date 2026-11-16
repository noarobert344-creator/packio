import { beforeEach, describe, expect, it } from "vitest";
import { setParcelsProcessed } from "@/server/services/preparers";
import { listPreparerCapacities } from "@/server/services/assignments";
import { createAdmin, createCustomer, createPreparerWithLocation, db, resetDb } from "../helpers";

describe("Colis traités d'un préparateur : correction par l'administration", () => {
  beforeEach(resetDb);

  it("valeur modifiable avec motif journalisé, visible à l'attribution ; refusée hors administration", async () => {
    const admin = await createAdmin();
    const { preparer, actor: prepActor } = await createPreparerWithLocation(admin);
    expect((await listPreparerCapacities()).find((p) => p.id === preparer.id)?.parcelsProcessed).toBe(0);

    await setParcelsProcessed(admin, { preparerId: preparer.id, value: 1500, reason: "Colis préparés avant Packio" });
    expect((await listPreparerCapacities()).find((p) => p.id === preparer.id)?.parcelsProcessed).toBe(1500);
    const log = await db.auditLog.findFirstOrThrow({ where: { action: "preparer.parcels_corrected", entityId: preparer.id } });
    expect(log.summary).toBe("Colis traités : 0 → 1500. Motif : Colis préparés avant Packio");

    await expect(setParcelsProcessed(admin, { preparerId: preparer.id, value: -3, reason: "test" })).rejects.toMatchObject({ code: "VALUE" });
    await expect(setParcelsProcessed(prepActor, { preparerId: preparer.id, value: 9999, reason: "triche" })).rejects.toThrow();
    const { actor: client } = await createCustomer();
    await expect(setParcelsProcessed(client, { preparerId: preparer.id, value: 9999, reason: "triche" })).rejects.toThrow();
    expect((await db.preparerProfile.findUniqueOrThrow({ where: { id: preparer.id } })).parcelsProcessed).toBe(1500);
  });
});
