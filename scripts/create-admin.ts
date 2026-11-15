/**
 * Création du compte super administrateur (propriétaire de Packio).
 *
 *   npm run admin:create -- --email vous@domaine.fr --first Prénom --last Nom
 *
 * Un lien d'activation (valable 7 jours) est envoyé par e-mail et affiché dans
 * la console : le mot de passe est choisi par l'administrateur lui-même.
 */
import "dotenv/config";
import { db } from "@/server/db";
import { seedReferenceData } from "@/server/seed/reference";
import { createAuthToken, normalizeEmail } from "@/server/services/auth";
import { sendEmail } from "@/server/services/email";
import { audit } from "@/server/services/audit";

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const email = arg("email");
  const firstName = arg("first") ?? "Administrateur";
  const lastName = arg("last") ?? "Packio";
  if (!email) throw new Error("Usage : npm run admin:create -- --email vous@domaine.fr --first Prénom --last Nom");
  await seedReferenceData(db);
  const role = await db.role.findUniqueOrThrow({ where: { key: "super_admin" } });
  const normalized = normalizeEmail(email);
  const existing = await db.user.findUnique({ where: { email: normalized } });
  if (existing && existing.role !== "ADMIN") throw new Error("Cette adresse appartient déjà à un compte client ou préparateur.");
  const user = existing
    ? await db.user.update({ where: { id: existing.id }, data: { staffRoleId: role.id, status: "ACTIVE" } })
    : await db.user.create({ data: { email: normalized, role: "ADMIN", staffRoleId: role.id, firstName, lastName } });
  await audit({ actor: null, action: "admin.bootstrap", entityType: "user", entityId: user.id, summary: normalized });
  const token = await createAuthToken(user.id, "INVITATION", { days: 7 });
  const url = `${(process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "")}/invitation?token=${token}`;
  await sendEmail({
    to: user.email,
    subject: "Activez votre accès super administrateur Packio",
    template: "invitation",
    title: "Votre accès au back-office Packio",
    paragraphs: [`Bonjour ${user.firstName},`, "Choisissez votre mot de passe pour activer votre compte super administrateur (lien valable 7 jours)."],
    cta: { label: "Activer mon compte", url },
    userId: user.id,
  });
  console.log(`✓ Super administrateur ${existing ? "mis à jour" : "créé"} : ${user.email}`);
  console.log(`  Lien d'activation (7 jours) : ${url}`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
