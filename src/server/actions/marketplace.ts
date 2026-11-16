"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/lib/action-types";
import { formToObject, runAction } from "@/server/action";
import { optionalDate, optionalEuroToCents, optionalText, requiredText, stringArray } from "@/lib/forms";
import { createExtensionToken, createManualSale, deleteSale, keepCancelledSaleItems, matchSaleToItems, revokeExtensionToken } from "@/server/services/marketplace";

const id = z.string().min(1).max(40);

/** Crée un jeton de l'extension : sa valeur n'est affichée qu'une fois. */
export async function createExtensionTokenAction(_prev: ActionState<{ token: string }>, formData: FormData): Promise<ActionState<{ token: string }>> {
  return runAction(z.object({ label: z.string().max(60).optional() }), formToObject(formData), async (actor, data) => {
    const { token } = await createExtensionToken(actor, data.label ?? "");
    revalidatePath("/client/ventes");
    return { ok: true, message: "Jeton créé : copiez-le maintenant, il ne sera plus affiché.", data: { token } };
  });
}

export async function revokeExtensionTokenAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(z.object({ tokenId: id }), formToObject(formData), async (actor, data) => {
    await revokeExtensionToken(actor, data.tokenId);
    revalidatePath("/client/ventes");
    return { ok: true, message: "Jeton révoqué : l'extension qui l'utilisait est déconnectée." };
  });
}

export async function matchSaleAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(z.object({ saleId: id, itemIds: stringArray() }), formToObject(formData), async (actor, data) => {
    await matchSaleToItems(actor, data);
    revalidatePath("/client/ventes");
    revalidatePath("/client/expeditions");
    return {
      ok: true,
      message: data.itemIds.length > 1 ? "Vente normale : votre préparateur expédie le lot dans un seul carton, sous 48 h." : "Vente normale : votre préparateur expédie l'article sous 48 h.",
    };
  });
}

const manualSaleSchema = z.object({
  platform: z.enum(["VINTED", "VESTIAIRE", "OTHER"], { error: "Plateforme requise" }),
  title: requiredText("Article vendu", 2, 300),
  externalOrderId: optionalText(80),
  price: optionalEuroToCents("Prix"),
  buyerName: optionalText(120),
  size: optionalText(40),
  shipBy: optionalDate(),
  labelFileIds: stringArray(),
});

export async function createManualSaleAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(manualSaleSchema, formToObject(formData), async (actor, data) => {
    // Date limite choisie au jour près : fin de journée plutôt que minuit.
    const shipBy = data.shipBy ? new Date(data.shipBy.getTime() + 18 * 3_600_000) : null;
    const sale = await createManualSale(actor, { ...data, shipBy, priceCents: data.price ?? null, labelFileId: data.labelFileIds[0] ?? null });
    revalidatePath("/client/ventes");
    return {
      ok: true,
      message:
        sale.status === "SHIPMENT_CREATED"
          ? "Vente ajoutée : l'article a été trouvé dans votre stock, votre préparateur l'expédie."
          : "Vente ajoutée à « Toutes mes ventes » : choisissez vente normale, vente dropshipping ou supprimer.",
    };
  });
}

export async function keepCancelledSaleAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(z.object({ saleId: id }), formToObject(formData), async (actor, data) => {
    const { kept } = await keepCancelledSaleItems(actor, data.saleId);
    revalidatePath("/client/ventes");
    revalidatePath("/client/stock", "layout");
    return { ok: true, message: kept ? "Article gardé dans votre stock chez votre préparateur." : "Aucun article à garder." };
  });
}

export async function deleteSaleAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(z.object({ saleId: id }), formToObject(formData), async (actor, data) => {
    await deleteSale(actor, data.saleId);
    revalidatePath("/client/ventes");
    return { ok: true, message: "Vente supprimée : elle n'apparaîtra plus dans la liste." };
  });
}
