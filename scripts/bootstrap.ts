/**
 * Amorçage d'une base (production comprise) : données de référence uniquement
 * (rôles système, offres, catégories de colis, recharges, fournisseurs).
 * Idempotent — n'écrase jamais une valeur modifiée par l'administration.
 * Aucune donnée de démonstration n'est créée.
 *
 * Si INITIAL_ADMIN_EMAIL est défini et que ce compte n'a pas encore choisi son
 * mot de passe, le super administrateur est créé et son lien d'activation
 * (7 jours) est affiché dans les journaux et envoyé par e-mail.
 *
 *   npm run db:bootstrap
 */
import "dotenv/config";
import { db } from "@/server/db";
import { seedReferenceData } from "@/server/seed/reference";
import { createAuthToken, normalizeEmail } from "@/server/services/auth";
import { sendEmail } from "@/server/services/email";
import { audit } from "@/server/services/audit";

async function initialAdmin() {
  const raw = process.env.INITIAL_ADMIN_EMAIL?.trim();
  if (!raw) return;
  const email = normalizeEmail(raw);
  const existing = await db.user.findUnique({ where: { email } });
  if (existing?.passwordHash) return; // déjà activé : rien à faire
  if (existing && existing.role !== "ADMIN") {
    console.warn(`⚠ INITIAL_ADMIN_EMAIL (${email}) appartient à un compte client ou préparateur : ignoré.`);
    return;
  }
  const role = await db.role.findUniqueOrThrow({ where: { key: "super_admin" } });
  const user = existing
    ? await db.user.update({ where: { id: existing.id }, data: { staffRoleId: role.id, status: "ACTIVE" } })
    : await db.user.create({ data: { email, role: "ADMIN", staffRoleId: role.id, firstName: "Administrateur", lastName: "Packio" } });
  if (!existing) await audit({ actor: null, action: "admin.bootstrap", entityType: "user", entityId: user.id, summary: email });
  const token = await createAuthToken(user.id, "INVITATION", { days: 7 });
  const url = `${(process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "")}/invitation?token=${token}`;
  await sendEmail({
    to: user.email,
    subject: "Activez votre accès super administrateur Packio",
    template: "invitation",
    title: "Votre accès au back-office Packio",
    paragraphs: ["Bonjour,", "Choisissez votre mot de passe pour activer votre compte super administrateur (lien valable 7 jours)."],
    cta: { label: "Activer mon compte", url },
    userId: user.id,
  });
  console.log(`✓ Super administrateur ${email} : lien d'activation (7 jours)`);
  console.log(`  ${url}`);
}

async function main() {
  await seedReferenceData(db);
  const [plans, suppliers, rules, roles] = await Promise.all([db.plan.count(), db.supplier.count(), db.parcelSizeRule.count(), db.role.count()]);
  console.log(`✓ Données de référence prêtes : ${plans} offres, ${rules} catégories de colis, ${suppliers} fournisseurs, ${roles} rôles.`);
  await initialAdmin();
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
