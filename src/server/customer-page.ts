import "server-only";
import { redirect } from "next/navigation";
import { requireCustomer } from "@/server/auth/current";
import { db } from "@/server/db";

/** Garde des pages client nécessitant un abonnement souscrit. */
export async function requireSubscribedCustomer() {
  const actor = await requireCustomer();
  const customer = await db.customerProfile.findUniqueOrThrow({ where: { id: actor.customerId } });
  if (customer.status === "PENDING_PAYMENT") redirect("/client/abonnement");
  return { actor, customer };
}
