import { randomUUID } from "node:crypto";
import { addDays, addHours, subMinutes } from "date-fns";
import type { AuthTokenType } from "@/generated/prisma/enums";
import { db, type Tx } from "@/server/db";
import { env } from "@/server/env";
import { DomainError } from "@/server/errors";
import {
  hashPassword,
  isStrongPassword,
  PASSWORD_RULES,
  verifyPassword,
} from "@/server/auth/password";
import { generateToken, hashToken } from "@/server/auth/tokens";
import { revokeAllSessions } from "@/server/auth/session-store";
import { assertAdmin, type Actor } from "@/server/auth/actor";
import { randomCode } from "@/server/lib/ids";
import { audit } from "./audit";
import { sendEmail } from "./email";
import { notifyNow } from "./notifications";

const MAX_FAILED_PER_EMAIL = 5;
const MAX_FAILED_PER_IP = 25;
const WINDOW_MINUTES = 15;

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

async function uniqueCustomerCode(tx: Tx) {
  for (let i = 0; i < 8; i++) {
    const code = `PK-${randomCode(5)}`;
    if (
      !(await tx.customerProfile.findUnique({
        where: { referenceCode: code },
        select: { id: true },
      }))
    )
      return code;
  }
  throw new Error("Impossible de générer un code client unique");
}

export async function createAuthToken(
  userId: string,
  type: AuthTokenType,
  ttl: { hours?: number; days?: number },
  client: Tx | typeof db = db,
) {
  const token = generateToken();
  const expiresAt = ttl.days
    ? addDays(new Date(), ttl.days)
    : addHours(new Date(), ttl.hours ?? 1);
  await client.authToken.create({
    data: { userId, type, tokenHash: hashToken(token), expiresAt },
  });
  return token;
}

async function consumeAuthToken(token: string, type: AuthTokenType) {
  const row = await db.authToken.findUnique({
    where: { tokenHash: hashToken(token) },
  });
  if (!row || row.type !== type || row.usedAt || row.expiresAt < new Date()) {
    throw new DomainError("INVALID_TOKEN", "Ce lien est invalide ou a expiré.");
  }
  const res = await db.authToken.updateMany({
    where: { id: row.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (res.count !== 1)
    throw new DomainError("INVALID_TOKEN", "Ce lien a déjà été utilisé.");
  return row;
}

export type RegisterInput = {
  /** Facultatifs : demandés après le paiement (formulaire imposé). */
  firstName?: string | null;
  lastName?: string | null;
  email: string;
  password: string;
  phone?: string | null;
  companyName?: string | null;
  /** Adresse du client (demandée après le paiement ; sert aussi aux retours à domicile). */
  address?: {
    line1: string;
    line2?: string | null;
    postalCode: string;
    city: string;
    country: string;
  } | null;
};

/** Inscription d'un client. Le compte est activé après paiement de l'abonnement. */
/** Espace client sur le compte d'un administrateur (pour utiliser Packio comme un client). */
export async function enableAdminCustomerProfile(actor: Actor) {
  assertAdmin(actor);
  const existing = await db.customerProfile.findUnique({
    where: { userId: actor.userId },
    select: { id: true },
  });
  if (existing) return existing;
  return db.$transaction(async (tx) => {
    const profile = await tx.customerProfile.create({
      data: {
        userId: actor.userId,
        referenceCode: await uniqueCustomerCode(tx),
        wallet: { create: {} },
      },
      select: { id: true, referenceCode: true },
    });
    await audit(
      {
        actor,
        action: "customer.admin_enabled",
        entityType: "customer",
        entityId: profile.id,
        summary: `${actor.firstName} ${actor.lastName} (administrateur), code ${profile.referenceCode}`,
      },
      tx,
    );
    return { id: profile.id };
  });
}

export async function registerCustomer(input: RegisterInput) {
  const email = normalizeEmail(input.email);
  if (!isStrongPassword(input.password)) {
    throw new DomainError("WEAK_PASSWORD", PASSWORD_RULES, {
      fieldErrors: { password: PASSWORD_RULES },
    });
  }
  const exists = await db.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (exists) {
    throw new DomainError(
      "EMAIL_TAKEN",
      "Un compte existe déjà avec cette adresse e-mail.",
      { fieldErrors: { email: "Adresse déjà utilisée" } },
    );
  }
  const passwordHash = await hashPassword(input.password);
  // Sans nom à l'inscription : le début de l'e-mail sert de nom provisoire (affiché
  // à l'équipe) jusqu'au formulaire imposé après le paiement ; nom de famille vide.
  const firstName = input.firstName?.trim() || email.split("@")[0].slice(0, 60);
  const lastName = input.lastName?.trim() || "";
  const user = await db.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        email,
        passwordHash,
        role: "CUSTOMER",
        firstName,
        lastName,
        phone: input.phone?.trim() || null,
        customerProfile: {
          create: {
            referenceCode: await uniqueCustomerCode(tx),
            companyName: input.companyName?.trim() || null,
            ...(input.address
              ? {
                  returnName: `${firstName} ${lastName}`.trim(),
                  returnPhone: input.phone?.trim() || null,
                  returnAddressLine1: input.address.line1.trim(),
                  returnAddressLine2: input.address.line2?.trim() || null,
                  returnPostalCode: input.address.postalCode.trim(),
                  returnCity: input.address.city.trim(),
                  returnCountry:
                    input.address.country.trim().toUpperCase() || "FR",
                }
              : {}),
            wallet: { create: {} },
          },
        },
      },
      include: { customerProfile: true },
    });
    await audit(
      {
        actor: { userId: created.id, role: "CUSTOMER" },
        action: "account.created",
        entityType: "user",
        entityId: created.id,
      },
      tx,
    );
    return created;
  });
  const verifyToken = await createAuthToken(user.id, "EMAIL_VERIFICATION", {
    days: 7,
  });
  await notifyNow(user.id, {
    type: "ACCOUNT_CREATED",
    title: "Bienvenue sur Packio",
    body: `Votre compte est créé. Votre code client est ${user.customerProfile!.referenceCode}. Choisissez votre abonnement pour activer votre espace.`,
    link: "/client",
  });
  await sendEmail({
    to: user.email,
    subject: "Confirmez votre adresse e-mail — Packio",
    template: "email_verification",
    title: "Confirmez votre adresse e-mail",
    paragraphs: [
      lastName ? `Bonjour ${firstName},` : "Bonjour,",
      "Merci de confirmer votre adresse e-mail pour sécuriser votre compte Packio.",
    ],
    cta: {
      label: "Confirmer mon adresse",
      url: `${env.appUrl}/verifier-email?token=${verifyToken}`,
    },
    userId: user.id,
  });
  return user;
}

/** Vérification des identifiants avec limitation des tentatives (anti force brute). */
export async function authenticate(
  emailInput: string,
  password: string,
  ip: string | null,
) {
  const email = normalizeEmail(emailInput);
  const since = subMinutes(new Date(), WINDOW_MINUTES);
  const [failedEmail, failedIp] = await Promise.all([
    db.loginAttempt.count({
      where: { email, success: false, createdAt: { gte: since } },
    }),
    ip
      ? db.loginAttempt.count({
          where: { ip, success: false, createdAt: { gte: since } },
        })
      : 0,
  ]);
  if (failedEmail >= MAX_FAILED_PER_EMAIL || failedIp >= MAX_FAILED_PER_IP) {
    throw new DomainError(
      "RATE_LIMITED",
      `Trop de tentatives. Réessayez dans ${WINDOW_MINUTES} minutes ou réinitialisez votre mot de passe.`,
      { status: 429 },
    );
  }
  const user = await db.user.findUnique({ where: { email } });
  const ok = user
    ? await verifyPassword(password, user.passwordHash)
    : await verifyPassword(
        password,
        "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA",
      );
  await db.loginAttempt.create({
    data: { email, ip, success: ok && !!user && user.status === "ACTIVE" },
  });
  if (!user || !ok)
    throw new DomainError(
      "INVALID_CREDENTIALS",
      "Adresse e-mail ou mot de passe incorrect.",
    );
  if (user.status !== "ACTIVE")
    throw new DomainError(
      "ACCOUNT_DISABLED",
      "Ce compte est désactivé. Contactez le support Packio.",
    );
  return user;
}

export async function requestPasswordReset(emailInput: string) {
  const email = normalizeEmail(emailInput);
  const user = await db.user.findUnique({ where: { email } });
  if (!user || user.status !== "ACTIVE") return; // réponse identique : pas d'énumération des comptes
  const recent = await db.authToken.count({
    where: {
      userId: user.id,
      type: "PASSWORD_RESET",
      createdAt: { gte: subMinutes(new Date(), 5) },
    },
  });
  if (recent >= 3) return;
  const token = await createAuthToken(user.id, "PASSWORD_RESET", { hours: 1 });
  await sendEmail({
    to: user.email,
    subject: "Réinitialisation de votre mot de passe — Packio",
    template: "password_reset",
    title: "Réinitialiser votre mot de passe",
    paragraphs: [
      `Bonjour ${user.firstName},`,
      "Vous avez demandé la réinitialisation de votre mot de passe. Ce lien est valable 1 heure.",
      "Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail.",
    ],
    cta: {
      label: "Choisir un nouveau mot de passe",
      url: `${env.appUrl}/reinitialiser-mot-de-passe?token=${token}`,
    },
    userId: user.id,
  });
}

export async function resetPassword(token: string, password: string) {
  if (!isStrongPassword(password))
    throw new DomainError("WEAK_PASSWORD", PASSWORD_RULES, {
      fieldErrors: { password: PASSWORD_RULES },
    });
  const row = await consumeAuthToken(token, "PASSWORD_RESET");
  await db.user.update({
    where: { id: row.userId },
    data: { passwordHash: await hashPassword(password) },
  });
  await revokeAllSessions(row.userId);
  await audit({
    actor: { userId: row.userId, role: "CUSTOMER" },
    action: "account.password_reset",
    entityType: "user",
    entityId: row.userId,
  });
  await notifyNow(row.userId, {
    type: "SECURITY",
    title: "Mot de passe modifié",
    body: "Le mot de passe de votre compte vient d'être réinitialisé. Contactez le support si vous n'êtes pas à l'origine de cette action.",
  });
  return row.userId;
}

/** Activation d'un compte préparateur / administrateur invité. */
export async function acceptInvitation(token: string, password: string) {
  if (!isStrongPassword(password))
    throw new DomainError("WEAK_PASSWORD", PASSWORD_RULES, {
      fieldErrors: { password: PASSWORD_RULES },
    });
  const row = await consumeAuthToken(token, "INVITATION");
  await db.user.update({
    where: { id: row.userId },
    data: {
      passwordHash: await hashPassword(password),
      emailVerifiedAt: new Date(),
    },
  });
  await audit({
    actor: { userId: row.userId, role: "PREPARER" },
    action: "account.invitation_accepted",
    entityType: "user",
    entityId: row.userId,
  });
  return row.userId;
}

export async function verifyEmail(token: string) {
  const row = await consumeAuthToken(token, "EMAIL_VERIFICATION");
  await db.user.update({
    where: { id: row.userId },
    data: { emailVerifiedAt: new Date() },
  });
  return row.userId;
}

export async function changePassword(
  userId: string,
  current: string,
  next: string,
  keepSessionId?: string,
) {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  if (!(await verifyPassword(current, user.passwordHash))) {
    throw new DomainError("WRONG_PASSWORD", "Mot de passe actuel incorrect.", {
      fieldErrors: { currentPassword: "Incorrect" },
    });
  }
  if (!isStrongPassword(next))
    throw new DomainError("WEAK_PASSWORD", PASSWORD_RULES, {
      fieldErrors: { newPassword: PASSWORD_RULES },
    });
  await db.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(next) },
  });
  await revokeAllSessions(userId, keepSessionId);
  await notifyNow(userId, {
    type: "SECURITY",
    title: "Mot de passe modifié",
    body: "Votre mot de passe a été modifié. Les autres sessions ont été déconnectées.",
  });
}

/** Envoi d'une invitation (préparateur ou membre de l'équipe Packio). */
export async function sendInvitation(userId: string) {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  const token = await createAuthToken(user.id, "INVITATION", { days: 7 });
  const url = `${env.appUrl}/invitation?token=${token}`;
  await sendEmail({
    to: user.email,
    subject: "Votre accès Packio",
    template: "invitation",
    title:
      user.role === "PREPARER"
        ? "Bienvenue dans le réseau des préparateurs Packio"
        : "Votre accès au back-office Packio",
    paragraphs: [
      `Bonjour ${user.firstName},`,
      "Un compte Packio a été créé pour vous. Choisissez votre mot de passe pour l'activer (lien valable 7 jours).",
    ],
    cta: { label: "Activer mon compte", url },
    userId: user.id,
  });
  return { url };
}

/** Anonymisation RGPD d'un compte (droit à l'effacement), sans casser les registres. */
export async function anonymizeUser(actorId: string, userId: string) {
  const user = await db.user.findUniqueOrThrow({
    where: { id: userId },
    include: { customerProfile: true },
  });
  if (user.customerProfile) {
    const [active, stock] = await Promise.all([
      db.subscription.count({
        where: {
          customerId: user.customerProfile.id,
          status: { in: ["ACTIVE", "TRIALING", "PAST_DUE"] },
        },
      }),
      db.inventoryItem.aggregate({
        where: { customerId: user.customerProfile.id },
        _sum: { quantityAvailable: true, quantityReserved: true },
      }),
    ]);
    if (active)
      throw new DomainError(
        "ACTIVE_SUB",
        "Résiliez l'abonnement avant d'anonymiser ce compte.",
      );
    if (
      (stock._sum.quantityAvailable ?? 0) + (stock._sum.quantityReserved ?? 0) >
      0
    ) {
      throw new DomainError(
        "STOCK",
        "Le client a encore du stock : organisez sa restitution avant l'anonymisation.",
      );
    }
  }
  await db.user.update({
    where: { id: userId },
    data: {
      email: `supprime+${randomUUID()}@packio.invalid`,
      firstName: "Utilisateur",
      lastName: "supprimé",
      phone: null,
      passwordHash: null,
      status: "DEACTIVATED",
    },
  });
  await revokeAllSessions(userId);
  await audit({
    actor: { userId: actorId, role: "ADMIN" },
    action: "account.anonymized",
    entityType: "user",
    entityId: userId,
  });
}
