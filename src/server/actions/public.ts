"use server";

import { subHours } from "date-fns";
import { z } from "zod";
import type { ActionState } from "@/lib/action-types";
import { emailField, requiredText } from "@/lib/forms";
import { formToObject, toActionError, zodFieldErrors } from "@/server/action";
import { DomainError } from "@/server/errors";
import { withEffects } from "@/server/services/notifications";

const contactSchema = z.object({
  name: requiredText("Nom", 2, 120),
  email: emailField(),
  subject: requiredText("Objet", 3, 160),
  message: requiredText("Message", 10, 5000),
  website: z.string().max(200).optional(),
});

const MAX_PER_HOUR = 3;

/** Formulaire de contact public : validation, anti-robot, limitation, alerte admin. */
export async function contactAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = contactSchema.safeParse(formToObject(formData));
  if (!parsed.success) return { ok: false, error: "Certains champs sont invalides.", fieldErrors: zodFieldErrors(parsed.error) };
  const data = parsed.data;
  const success: ActionState = { ok: true, message: "Merci, votre message a bien été envoyé. Nous vous répondons par e-mail." };
  // Champ piège invisible : un robot le remplit, on simule le succès sans rien enregistrer.
  if (data.website && data.website.trim() !== "") return success;
  try {
    await withEffects(async (tx, fx) => {
      const recent = await tx.contactRequest.count({ where: { email: data.email, createdAt: { gte: subHours(new Date(), 1) } } });
      if (recent >= MAX_PER_HOUR) {
        throw new DomainError("RATE_LIMITED", "Vous avez déjà envoyé plusieurs messages récemment. Réessayez dans une heure.", { status: 429 });
      }
      const request = await tx.contactRequest.create({
        data: { name: data.name, email: data.email, subject: data.subject, message: data.message },
      });
      fx.notifyAdmins(
        {
          type: "ADMIN_CONTACT_REQUEST",
          title: "Nouveau message de contact",
          body: `${data.name} (${data.email}) : ${data.subject}`,
          link: "/admin/support?onglet=contact",
          data: { contactRequestId: request.id },
        },
        "support.manage",
      );
    });
  } catch (err) {
    return toActionError(err);
  }
  return success;
}
