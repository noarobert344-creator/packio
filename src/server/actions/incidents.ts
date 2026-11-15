"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/lib/action-types";
import { checkbox, optionalText, requiredText, stringArray } from "@/lib/forms";
import { formToObject, runAction } from "@/server/action";
import { addIncidentUpdate, reportIncident } from "@/server/services/incidents";

const TYPES = ["INBOUND_DAMAGED", "INBOUND_MISSING", "WRONG_ITEM", "LOCKER_ISSUE", "SHIPMENT_ISSUE", "CLASSIFICATION_DISPUTE", "STOCK_DISCREPANCY", "PAYMENT", "ASSIGNMENT_DELAY", "PREPARER_ABSENCE", "OTHER"] as const;

const reportSchema = z.object({
  type: z.enum(TYPES, { error: "Choisissez un type d'incident" }),
  title: requiredText("Titre", 3, 200),
  description: requiredText("Description", 5, 5000),
  supplierOrderId: optionalText(40),
  shipmentId: optionalText(40),
  inventoryItemId: optionalText(40),
  photoIds: stringArray(),
});

export async function reportIncidentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(reportSchema, formToObject(formData), async (actor, data) => {
    const incident = await reportIncident(actor, data);
    const base = actor.role === "CUSTOMER" ? "/client/incidents" : actor.role === "PREPARER" ? "/preparateur/incidents" : "/admin/incidents";
    revalidatePath(base);
    return { ok: true, message: `Incident ${incident.reference} signalé. L'équipe Packio est prévenue.`, redirectTo: `${base}/${incident.id}` };
  });
}

const updateSchema = z.object({
  incidentId: z.string(),
  body: requiredText("Message", 2, 5000),
  status: z.enum(["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"]).optional().or(z.literal("").transform(() => undefined)),
  internal: checkbox(),
  resolution: optionalText(2000),
});

export async function addIncidentUpdateAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(updateSchema, formToObject(formData), async (actor, data) => {
    await addIncidentUpdate(actor, data);
    revalidatePath("/", "layout");
    return { ok: true, message: "Réponse ajoutée." };
  });
}
