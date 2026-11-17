import { beforeEach, describe, expect, it } from "vitest";
import { devCompleteSubscription } from "@/server/billing";
import { registerCustomer } from "@/server/services/auth";
import {
  completeCustomerDetails,
  customerDetailsGate,
} from "@/server/services/customers";
import {
  actorFor,
  createAdmin,
  createCustomer,
  createPreparerWithLocation,
  db,
  resetDb,
} from "../helpers";

describe("Inscription minimale puis informations imposées après le paiement", () => {
  beforeEach(resetDb);

  it("e-mail + mot de passe à l'inscription, formulaire imposé une fois l'abonnement payé", async () => {
    const user = await registerCustomer({
      email: "jean.dupont@test.local",
      password: "MotDePasse2026",
    });
    // Nom provisoire (début de l'e-mail), pas encore de téléphone ni d'adresse.
    expect(user).toMatchObject({
      firstName: "jean.dupont",
      lastName: "",
      phone: null,
    });
    let actor = await actorFor(user.id);

    // Avant le paiement : pas de formulaire (le client choisit son offre).
    expect(await customerDetailsGate(actor.customerId!)).toBeNull();

    const plan = await db.plan.findUniqueOrThrow({
      where: { code: "STARTER" },
    });
    await devCompleteSubscription(actor, plan.id, "MONTHLY");
    actor = await actorFor(user.id);
    // Après le paiement : formulaire imposé, le prénom provisoire n'est pas repris.
    expect(await customerDetailsGate(actor.customerId!)).toMatchObject({
      firstName: "",
      lastName: "",
      phone: "",
      addressLine1: "",
      country: "FR",
    });

    await expect(
      completeCustomerDetails(actor, {
        firstName: "Jean",
        lastName: " ",
        phone: "06 12 34 56 78",
        addressLine1: "12 rue de la Paix",
        postalCode: "75002",
        city: "Paris",
        country: "FR",
      }),
    ).rejects.toMatchObject({ code: "DETAILS_REQUIRED" });
    await completeCustomerDetails(actor, {
      firstName: "Jean",
      lastName: "Dupont",
      phone: "06 12 34 56 78",
      addressLine1: "12 rue de la Paix",
      postalCode: "75002",
      city: "Paris",
      country: "FR",
    });
    expect(await customerDetailsGate(actor.customerId!)).toBeNull();
    expect(
      await db.user.findUniqueOrThrow({ where: { id: user.id } }),
    ).toMatchObject({
      firstName: "Jean",
      lastName: "Dupont",
      phone: "06 12 34 56 78",
    });
    expect(
      await db.customerProfile.findUniqueOrThrow({
        where: { id: actor.customerId! },
      }),
    ).toMatchObject({
      returnName: "Jean Dupont",
      returnPhone: "06 12 34 56 78",
      returnAddressLine1: "12 rue de la Paix",
      returnPostalCode: "75002",
      returnCity: "Paris",
    });
  });

  it("aucun formulaire pour un client déjà complet ; réservé au client lui-même", async () => {
    const client = await createCustomer();
    expect(await customerDetailsGate(client.customerId)).toBeNull();
    const admin = await createAdmin();
    const { actor: preparer } = await createPreparerWithLocation(admin);
    const details = {
      firstName: "X",
      lastName: "Y",
      phone: "0612345678",
      addressLine1: "1 rue A",
      postalCode: "75001",
      city: "Paris",
      country: "FR",
    };
    await expect(completeCustomerDetails(preparer, details)).rejects.toThrow();
    await expect(completeCustomerDetails(admin, details)).rejects.toThrow();
  });
});
