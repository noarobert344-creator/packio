"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/lib/action-types";
import { formToObject, runAction } from "@/server/action";
import { createExtensionToken, deleteSale, matchSaleToItem, revokeExtensionToken } from "@/server/services/marketplace";

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
  return runAction(z.object({ saleId: id, itemId: id }), formToObject(formData), async (actor, data) => {
    await matchSaleToItem(actor, data);
    revalidatePath("/client/ventes");
    revalidatePath("/client/expeditions");
    return { ok: true, message: "Vente normale : votre préparateur expédie l'article sous 48 h." };
  });
}

export async function deleteSaleAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(z.object({ saleId: id }), formToObject(formData), async (actor, data) => {
    await deleteSale(actor, data.saleId);
    revalidatePath("/client/ventes");
    return { ok: true, message: "Vente supprimée : elle n'apparaîtra plus dans la liste." };
  });
}
