/**
 * Amorçage d'une base (production comprise) : données de référence uniquement
 * (rôles système, offres, catégories de colis, recharges, fournisseurs).
 * Idempotent — n'écrase jamais une valeur modifiée par l'administration.
 * Aucune donnée de démonstration n'est créée.
 *
 *   npm run db:bootstrap
 */
import "dotenv/config";
import { db } from "@/server/db";
import { seedReferenceData } from "@/server/seed/reference";

async function main() {
  await seedReferenceData(db);
  const [plans, suppliers, rules, roles] = await Promise.all([db.plan.count(), db.supplier.count(), db.parcelSizeRule.count(), db.role.count()]);
  console.log(`✓ Données de référence prêtes : ${plans} offres, ${rules} catégories de colis, ${suppliers} fournisseurs, ${roles} rôles.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
