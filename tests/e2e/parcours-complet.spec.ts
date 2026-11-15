import { expect, test, type Browser, type Page } from "@playwright/test";

/**
 * Parcours utilisateur complet (cahier des charges, section 19) sur
 * l'application en mode démonstration :
 *  1. un visiteur choisit Starter, s'inscrit, paie, voit le message d'attente ;
 *  2. l'administrateur attribue manuellement un préparateur (Camille ou Yanis,
 *     selon la capacité restante) ;
 *  3. le client voit son préparateur et enregistre une commande ZenMarket (vers le stock) ;
 *  4. le préparateur réceptionne le colis et le met en stock ;
 *  5. le client demande une expédition ;
 *  6. le préparateur classe le colis (crédits réservés), prépare, dépose
 *     (crédits débités) avec le suivi transporteur ;
 *  7. le client voit l'expédition, son solde et échange avec son préparateur ;
 *  8. l'administrateur supervise l'avancement depuis le back-office.
 *
 * Prérequis : `npm run db:seed` (comptes de démonstration) et BILLING_MODE=dev.
 */

const PASSWORD = "MotDePasse-E2E-2026";
const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "Demo-Packio-2026";
const stamp = Date.now().toString(36);
const client = { first: "Alice", last: `Parcours ${stamp}`, email: `e2e-${stamp}@exemple.test` };
const thanks = `Merci pour l'envoi rapide ! (${stamp})`;

async function login(browser: Browser, email: string, password = DEMO_PASSWORD): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/connexion");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/connexion"));
  return page;
}

test("parcours complet client → admin → préparateur", async ({ page, browser }) => {
  // 1. Choix de l'offre Starter, inscription et paiement (simulé)
  await page.goto("/");
  await page.getByRole("link", { name: /Choisir Starter/ }).first().click();
  await expect(page).toHaveURL(/\/inscription\?offre=STARTER/);
  await page.locator('input[name="firstName"]').fill(client.first);
  await page.locator('input[name="lastName"]').fill(client.last);
  await page.locator('input[name="email"]').fill(client.email);
  await page.locator('input[name="password"]').fill(PASSWORD);
  await page.locator('input[name="acceptTerms"]').check();
  await page.getByRole("button", { name: "Créer mon compte" }).click();
  await expect(page).toHaveURL(/\/client\/abonnement/);
  await page.getByRole("button", { name: "Souscrire Starter" }).click();
  await expect(page).toHaveURL(/\/paiement-demo/);
  await page.getByRole("button", { name: /Simuler le paiement/ }).click();
  await expect(page).toHaveURL(/\/client\?abonnement=confirme/);
  await expect(page.getByRole("heading", { name: "Bienvenue sur Packio !" })).toBeVisible();
  await expect(page.getByText("Un préparateur de commandes personnel vous sera attribué sous 24 heures.", { exact: false })).toBeVisible();
  await expect(page.getByText("Échéance des 24 h")).toBeVisible();

  // 2. L'administrateur attribue manuellement un préparateur
  const admin = await login(browser, "admin@demo.packio.local");
  await admin.goto(`/admin/clients?q=${encodeURIComponent(client.email)}`);
  await admin.getByRole("link", { name: new RegExp(client.last) }).first().click();
  await admin.getByRole("button", { name: "Attribuer un préparateur" }).first().click();
  // Préparateur de démonstration disposant encore de capacité (la capacité maximale est appliquée).
  const candidates = [
    { name: "Camille Martin", email: "camille.martin@demo.packio.local" },
    { name: "Yanis Benali", email: "yanis.benali@demo.packio.local" },
  ];
  let preparer: (typeof candidates)[number] | undefined;
  for (const c of candidates) {
    const radio = admin.getByRole("radio", { name: new RegExp(c.name) });
    if ((await radio.count()) && (await radio.isEnabled())) {
      await radio.click();
      preparer = c;
      break;
    }
  }
  if (!preparer) throw new Error("Aucun préparateur de démonstration n'a de capacité disponible : réinitialisez la base de développement.");
  await admin.getByRole("button", { name: "Confirmer l'attribution" }).click();
  await expect(admin.getByText("est désormais le préparateur attitré", { exact: false })).toBeVisible();

  // 3. Le client voit son préparateur et son point de réception, puis commande sur ZenMarket (commande vers le stock)
  await expect(async () => {
    await page.goto("/client/preparateur");
    await expect(page.getByRole("heading", { name: preparer!.name })).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 30_000 });
  await expect(page.getByText("Adresses de réception validées")).toBeVisible();
  await page.goto("/client/commander");
  const form = page.locator("#nouvelle-commande");
  await form.locator('select[name="supplierId"]').selectOption({ label: "ZenMarket" });
  await form.locator('input[name="description"]').fill("Coque de téléphone transparente");
  await form.locator('input[name="quantity"]').fill("2");
  await form.locator('input[name="trackingNumber"]').fill("LPE2E000000001CN");
  await form.getByRole("button", { name: "Enregistrer la commande" }).click();
  await expect(page).toHaveURL(/\/client\/commandes\/[a-z0-9]+$/);
  const orderUrl = new URL(page.url());
  const orderId = orderUrl.pathname.split("/").pop()!;
  await expect(page.getByText("En cours d'acheminement").first()).toBeVisible();
  await expect(page.getByText("Numéro de suivi fourni à l'enregistrement")).toBeVisible();

  // 4. Le préparateur récupère, réceptionne et met en stock
  const prep = await login(browser, preparer.email);
  await prep.goto(`/preparateur/receptions/${orderId}`);
  // Livraison à l'adresse professionnelle : réception directe (pas de retrait au locker).
  await expect(prep.getByText("En cours d'acheminement").first()).toBeVisible();
  await prep.getByRole("button", { name: /Valider la réception/ }).click();
  await expect(prep.getByRole("button", { name: /Mettre en stock/ })).toBeVisible();
  await prep.getByRole("button", { name: /Mettre en stock/ }).click();
  await expect(prep.getByRole("button", { name: /Mettre en stock/ })).toBeHidden();

  // 5. Le client demande l'expédition d'un article stocké
  const stockedItem = page.getByRole("link", { name: /Coque de téléphone transparente/ }).first();
  await expect(async () => {
    await page.goto("/client/stock");
    await expect(stockedItem).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 30_000 });
  await stockedItem.click();
  await page.getByRole("link", { name: /Expédier/ }).click();
  await expect(page).toHaveURL(/\/client\/expeditions\/nouvelle/);
  await page.locator('input[name="recipientName"]').fill("Bruno Lefèvre");
  await page.locator('input[name="addressLine1"]').fill("8 rue Victor Hugo");
  await page.locator('input[name="postalCode"]').fill("13001");
  await page.locator('input[name="city"]').fill("Marseille");
  await page.getByText("Le préparateur crée l'étiquette").click();
  await page.getByRole("button", { name: "Demander l'expédition" }).click();
  await expect(page).toHaveURL(/\/client\/expeditions\/[a-z0-9]+$/);
  const shipmentId = new URL(page.url()).pathname.split("/").pop()!;
  await expect(page.getByText("En attente de classification").first()).toBeVisible();

  // 6. Le préparateur classe le colis (Moyen = 2 crédits), prépare, étiquette et dépose
  await prep.goto(`/preparateur/expeditions/${shipmentId}`);
  await prep.getByText("Moyen colis", { exact: true }).first().click();
  await prep.getByRole("button", { name: /Confirmer la classification/ }).click();
  await expect(prep.getByRole("button", { name: /Commencer la préparation/ })).toBeVisible();
  await prep.getByRole("button", { name: /Commencer la préparation/ }).click();
  await expect(prep.getByRole("button", { name: /Le colis est prêt/ })).toBeVisible();
  await prep.getByRole("button", { name: /Le colis est prêt/ }).click();
  const labelButton = prep.getByRole("button", { name: /Enregistrer l'étiquette/ });
  await expect(labelButton).toBeVisible();
  const labelCard = prep.locator("form", { has: labelButton });
  await labelCard.locator('input[type="file"]').setInputFiles({
    name: "etiquette.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"),
  });
  await expect(labelCard.getByText("etiquette.pdf")).toBeVisible();
  await labelButton.click();
  const dropOff = prep.getByRole("button", { name: /Confirmer le dépôt/ });
  await expect(dropOff).toBeVisible();
  await prep.locator('select[name="carrier"]').selectOption("COLISSIMO");
  await prep.locator('input[name="trackingNumber"]').fill("6AE2E00000001");
  await dropOff.click();
  await expect(prep.getByText("Crédits débités").first()).toBeVisible();

  // 7. Le client voit l'expédition, le débit de 2 crédits et écrit à son préparateur
  await page.goto(`/client/expeditions/${shipmentId}`);
  await expect(page.getByText("Déposé au transporteur").first()).toBeVisible();
  await expect(page.getByText("Crédits débités").first()).toBeVisible();
  await expect(page.getByRole("link", { name: /Suivre le colis/ })).toHaveAttribute("href", /laposte\.fr.*6AE2E00000001/);
  await page.goto("/client/credits");
  await expect(page.getByText("Solde disponible").locator("..")).toContainText("18");
  await page.goto("/client/preparateur");
  await page.getByRole("link", { name: /Envoyer un message/ }).click();
  await page.getByLabel("Message", { exact: true }).fill(thanks);
  await page.getByRole("button", { name: "Envoyer", exact: true }).click();
  await expect(page.getByText(thanks).last()).toBeVisible();
  await prep.goto("/preparateur/messages");
  await prep.getByRole("link", { name: new RegExp(client.last) }).first().click();
  await expect(prep.getByText(thanks).last()).toBeVisible();

  // 8. L'administrateur supervise l'avancement logistique
  await admin.goto(`/admin/expeditions/${shipmentId}`);
  await expect(admin.getByText("Déposé au transporteur").first()).toBeVisible();
  await expect(admin.getByText("6AE2E00000001").first()).toBeVisible();
});
