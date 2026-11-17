/**
 * Lancement réel, une seule fois : efface les comptes de démonstration et les
 * données de test (paiements simulés), garde les réglages et les comptes
 * réels, puis prépare l'espace préparateur et l'espace client du propriétaire
 * (INITIAL_ADMIN_EMAIL). Voir src/server/services/launch.ts pour le détail et
 * les garde-fous. Exécuté au pré-déploiement Render quand LAUNCH_RESET=1 ;
 * sans effet une fois le lancement fait.
 *
 *   LAUNCH_RESET=1 npm run db:launch
 */
import "dotenv/config";
import { db } from "@/server/db";
import { launchReset } from "@/server/services/launch";

async function main() {
  if (process.env.LAUNCH_RESET !== "1") {
    console.log("Lancement : LAUNCH_RESET n'est pas activé, rien à faire.");
    return;
  }
  const ownerEmail = process.env.INITIAL_ADMIN_EMAIL?.trim();
  if (!ownerEmail) throw new Error("Lancement refusé : INITIAL_ADMIN_EMAIL n'est pas renseigné.");
  const report = await launchReset({ ownerEmail });
  if (report.alreadyDone) {
    console.log("✓ Lancement déjà effectué : aucune donnée n'est effacée.");
    return;
  }
  console.log(`✓ Lancement : ${report.demoUsersDeleted} compte(s) de démonstration supprimé(s), ${report.filesDeleted} fichier(s) de test effacé(s), ${report.customersReset} compte(s) client remis à zéro.`);
  const o = report.owner!;
  console.log(`✓ Propriétaire : espace préparateur et espace client actif (offre ${o.plan}, ${o.credits} crédits offerts).`);
  console.log(o.assigned ? "✓ Espace client attribué à son propre espace préparateur." : `⚠ Attribution à faire depuis l'administration : ${o.assignNote}`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
