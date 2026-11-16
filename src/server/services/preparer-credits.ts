import { db } from "@/server/db";
import { DomainError, NotFoundError } from "@/server/errors";
import { assertPreparer, type Actor } from "@/server/auth/actor";
import { audit } from "./audit";
import { debitCredits } from "./credits";
import { withEffects } from "./notifications";

/** Plafond d'un retrait par le préparateur (au-delà : l'équipe Packio). */
export const PREPARER_DEBIT_MAX = 20;

/**
 * Retrait de crédits par le préparateur attitré (ex. emballage spécial, colis
 * hors gabarit) : motif obligatoire, envoyé au client dans la conversation,
 * notifié et journalisé. Réservé aux clients actuellement attribués.
 */
export async function preparerDebitCredits(actor: Actor, input: { customerId: string; amount: number; reason: string; requestId: string }) {
  const preparerId = assertPreparer(actor);
  const reason = input.reason.trim();
  if (!Number.isInteger(input.amount) || input.amount < 1 || input.amount > PREPARER_DEBIT_MAX) {
    throw new DomainError("AMOUNT", `Retrait de 1 à ${PREPARER_DEBIT_MAX} crédits.`, { fieldErrors: { amount: `Entre 1 et ${PREPARER_DEBIT_MAX}` } });
  }
  if (reason.length < 10) {
    throw new DomainError("REASON", "Expliquez le retrait à votre client (10 caractères minimum).", { fieldErrors: { reason: "Motif obligatoire" } });
  }
  const customer = await db.customerProfile.findUnique({ where: { id: input.customerId }, select: { id: true, userId: true, currentPreparerId: true } });
  if (!customer || customer.currentPreparerId !== preparerId) throw new NotFoundError("Client introuvable.");

  return withEffects(async (tx, fx) => {
    const { applied, debited } = await debitCredits(tx, {
      customerId: customer.id,
      amount: input.amount,
      type: "PREPARER_DEBIT",
      description: `Retrait par votre préparateur (${input.amount} crédit${input.amount > 1 ? "s" : ""})`,
      reason,
      actorId: actor.userId,
      idempotencyKey: `preparer:${preparerId}:${input.requestId}`,
    });
    if (!applied) return { applied, debited };

    // Justification au client, dans la conversation avec son préparateur.
    const body = `Retrait de ${debited} crédit${debited > 1 ? "s" : ""} de votre solde. Motif : ${reason}`;
    const conversation = await tx.conversation.findFirst({ where: { type: "CUSTOMER_PREPARER", preparerId, customerId: customer.id, status: "OPEN" }, select: { id: true } });
    if (conversation) {
      const message = await tx.message.create({ data: { conversationId: conversation.id, senderId: actor.userId, body } });
      await tx.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: message.createdAt } });
    }
    await audit(
      { actor, action: "credits.preparer_debit", entityType: "customer", entityId: customer.id, summary: `-${debited} crédit(s) — ${reason}`, metadata: { amount: debited } },
      tx,
    );
    fx.notify(customer.userId, {
      type: "CREDITS_REMOVED_BY_PREPARER",
      title: `${debited} crédit${debited > 1 ? "s" : ""} retiré${debited > 1 ? "s" : ""} par votre préparateur`,
      body: `Motif : ${reason}`,
      link: conversation ? `/client/messages?c=${conversation.id}` : "/client/credits",
    });
    return { applied, debited };
  });
}
