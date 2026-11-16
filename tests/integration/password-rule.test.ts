import { beforeEach, describe, expect, it } from "vitest";
import { isStrongPassword } from "@/server/auth/password";
import { registerCustomer } from "@/server/services/auth";
import { db, resetDb } from "../helpers";

describe("Inscription : mot de passe simple, sans téléphone ni société", () => {
  beforeEach(resetDb);

  it("8 caractères suffisent, sans chiffre ni majuscule imposés", async () => {
    expect(isStrongPassword("motdepasse")).toBe(true);
    expect(isStrongPassword("abcdefgh")).toBe(true);
    expect(isStrongPassword("court")).toBe(false);
    const user = await registerCustomer({ firstName: "Inès", lastName: "Test", email: "ines.simple@test.local", password: "soleil26" });
    expect(await db.user.findUniqueOrThrow({ where: { id: user.id }, select: { phone: true } })).toEqual({ phone: null });
    await expect(registerCustomer({ firstName: "A", lastName: "B", email: "court@test.local", password: "abc" })).rejects.toMatchObject({ code: "WEAK_PASSWORD" });
  });
});
