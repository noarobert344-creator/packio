"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionState } from "@/lib/action-types";
import { emailField, optionalText, phoneField, requiredText } from "@/lib/forms";
import { toActionError, zodFieldErrors, formToObject } from "@/server/action";
import { endSession, getSession, homePathFor, requestMeta, startSession } from "@/server/auth/current";
import { toActor } from "@/server/auth/session-store";
import { db } from "@/server/db";
import { DomainError } from "@/server/errors";
import { acceptInvitation, authenticate, registerCustomer, requestPasswordReset, resetPassword } from "@/server/services/auth";

function safeNext(next: unknown) {
  return typeof next === "string" && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/api/") ? next : null;
}

const loginSchema = z.object({ email: emailField(), password: z.string().min(1, { error: "Mot de passe requis" }).max(200), suivant: z.string().optional() });

export async function loginAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = loginSchema.safeParse(formToObject(formData));
  if (!parsed.success) return { ok: false, error: "Vérifiez vos identifiants.", fieldErrors: zodFieldErrors(parsed.error) };
  let destination: string;
  try {
    const { ip } = await requestMeta();
    const user = await authenticate(parsed.data.email, parsed.data.password, ip);
    await startSession(user.id);
    const full = await db.user.findUniqueOrThrow({ where: { id: user.id }, include: { staffRole: true, customerProfile: { select: { id: true } }, preparerProfile: { select: { id: true } } } });
    const actor = toActor(full);
    const next = safeNext(parsed.data.suivant);
    const home = homePathFor(actor);
    destination = next && next.startsWith(home) ? next : home;
  } catch (err) {
    return toActionError(err);
  }
  redirect(destination);
}

const registerSchema = z.object({
  firstName: requiredText("Prénom", 1, 60),
  lastName: requiredText("Nom", 1, 60),
  email: emailField(),
  phone: phoneField(),
  companyName: optionalText(120),
  password: z.string().min(1, { error: "Mot de passe requis" }).max(200),
  acceptTerms: z.literal("on", { error: "Vous devez accepter les conditions pour créer un compte" }),
  offre: z.string().optional(),
  periodicite: z.enum(["mensuel", "annuel"]).optional().catch(undefined),
});

export async function registerAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = registerSchema.safeParse(formToObject(formData));
  if (!parsed.success) return { ok: false, error: "Certains champs sont invalides.", fieldErrors: zodFieldErrors(parsed.error) };
  let offre: string | undefined;
  try {
    const user = await registerCustomer(parsed.data);
    await startSession(user.id);
    offre = parsed.data.offre?.toUpperCase();
  } catch (err) {
    return toActionError(err);
  }
  const params = new URLSearchParams();
  if (offre) params.set("offre", offre);
  if (parsed.data.periodicite === "annuel") params.set("periodicite", "annuel");
  redirect(params.size ? `/client/abonnement?${params}` : "/client/abonnement");
}

export async function logoutAction() {
  await endSession();
  redirect("/");
}

export async function forgotPasswordAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z.object({ email: emailField() }).safeParse(formToObject(formData));
  if (!parsed.success) return { ok: false, error: "Adresse e-mail invalide.", fieldErrors: zodFieldErrors(parsed.error) };
  try {
    await requestPasswordReset(parsed.data.email);
  } catch (err) {
    return toActionError(err);
  }
  return { ok: true, message: "Si un compte existe pour cette adresse, un lien de réinitialisation vient d'être envoyé." };
}

const passwordSchema = z
  .object({ token: z.string().min(10), password: z.string().max(200), confirm: z.string().max(200) })
  .refine((v) => v.password === v.confirm, { error: "Les mots de passe ne correspondent pas", path: ["confirm"] });

export async function resetPasswordAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = passwordSchema.safeParse(formToObject(formData));
  if (!parsed.success) return { ok: false, error: "Vérifiez le formulaire.", fieldErrors: zodFieldErrors(parsed.error) };
  try {
    await resetPassword(parsed.data.token, parsed.data.password);
  } catch (err) {
    return toActionError(err);
  }
  redirect("/connexion?reinitialise=1");
}

export async function acceptInvitationAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = passwordSchema.safeParse(formToObject(formData));
  if (!parsed.success) return { ok: false, error: "Vérifiez le formulaire.", fieldErrors: zodFieldErrors(parsed.error) };
  let home = "/";
  try {
    const userId = await acceptInvitation(parsed.data.token, parsed.data.password);
    await startSession(userId);
    const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
    home = homePathFor(user);
  } catch (err) {
    return toActionError(err);
  }
  redirect(home);
}

/** Redirige un utilisateur déjà connecté vers son espace. */
export async function redirectIfAuthenticated() {
  const session = await getSession();
  if (session) redirect(homePathFor(session.actor));
}

export async function assertNotDemoInProduction() {
  if (process.env.NODE_ENV === "production" && process.env.BILLING_MODE === "dev") {
    throw new DomainError("CONFIG", "Configuration invalide.");
  }
}
