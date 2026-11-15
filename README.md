# Packio

Packio relie une boutique à un préparateur attitré. L’administrateur attribue le préparateur manuellement. Le client déclare ses achats et choisit ses articles à expédier. Le préparateur réceptionne, met en stock, classe les colis et confirme leur dépôt.

## Essayer les trois espaces

[Ouvrir la branche dans GitHub Codespaces](https://codespaces.new/noarobert344-creator/packio/tree/feat/plateforme-packio). Créer l’espace puis ouvrir l’aperçu du port **3010**. Le conteneur démarre la démonstration avec une base dédiée. Conserver le port privé. Codespaces utilise les quotas du compte GitHub.

Sur ordinateur, avec Node.js 24 installé, ouvrir un terminal à la racine du projet et exécuter `npm run demo`. Ouvrir http://localhost:3010. Le serveur local et SQLite fonctionnent sans installation npm. Dans les deux cas, les adresses et les paiements de la démonstration sont fictifs.

| Rôle | Identifiant de démonstration |
| --- | --- |
| Administration | admin@packio.example |
| Préparation | prep@packio.example |
| Client | client@packio.example |

Sur la page **Connexion**, les boutons **Client**, **Préparateur** et **Administrateur** ouvrent directement le rôle choisi. Ils apparaissent uniquement dans la démonstration dédiée.

Mot de passe de ces comptes de démonstration uniquement : `Packio-Demo-Local!`. La commande dédiée utilise `var/demo.sqlite`. La base normale reste séparée. Pour tester l’attente sous 24 heures, créer un second client et choisir Starter. Avec le compte administrateur, ouvrir **Attributions**, puis **Attribuer**. Utiliser deux profils de navigateur pour tester les rôles simultanément.

## Parcours opérationnel

1. Le paiement confirmé active le compte et crédite le portefeuille. La page client affiche le délai de 24 heures. Le back-office affiche l’heure de souscription, l’échéance et les dossiers en retard.
2. Dans **Préparateurs**, créer un profil, valider son adresse, renseigner les transporteurs, les fournisseurs compatibles avec le locker, les horaires et les capacités. L’attribution ouvre la conversation logistique. Le client dispose également d’une conversation support.
3. Dans **Commandes**, le client enregistre une commande fournisseur et confirme le point réellement disponible lors du paiement. Le préparateur enregistre les étapes et la quantité effectivement réceptionnée.
4. Dans **Stock**, les unités disponibles, réservées et expédiées sont distinctes. La demande d’expédition réserve les articles dans une transaction. Un préparateur peut enregistrer une entrée manuelle ou un ajustement d’inventaire justifié.
5. Le préparateur confirme la taille. Le serveur réserve les crédits disponibles, puis les débite une seule fois au dépôt. Une demande insuffisamment provisionnée reste en attente. Après recharge, le préparateur reprend la classification. Une annulation avant préparation libère les réservations.
6. La réattribution exige la clôture des opérations en cours et une confirmation du transfert physique des unités disponibles. Les historiques et conversations archivées sont conservés.
7. L’administration peut changer les formules, leurs limites, les coûts par taille et les politiques de report. La supervision d’une conversation logistique exige un motif journalisé. Les notifications, incidents, mouvements et paiements sont consultables dans l’espace approprié.

## Extension Chrome Packio

Dans `chrome://extensions`, activer le **Mode développeur**, choisir **Charger l’extension non empaquetée** et sélectionner le dossier `extension/`. Ouvrir Vinted, ZenMarket, SHEIN ou AliExpress, cliquer sur Packio et saisir l’origine de son propre espace Packio. Le bouton d’import prépare un formulaire à partir du titre et du lien de l’onglet. Sur Vinted, le bouton de vente ouvre la demande d’expédition. Le client choisit le stock et confirme.

Les permissions Chrome sont `activeTab` et `storage`. L’extension agit au clic. Les données proposées passent dans le fragment de l’URL. La création d’une opération utilise la session Packio du client et ses droits habituels. Les bordereaux s’ajoutent dans le formulaire. La distribution se fait depuis les sources du dépôt.

## Configuration d’un environnement réel

- Utiliser Node.js 24 et PostgreSQL. Copier `.env.example` vers `.env`. Définir `APP_URL` avec l’origine HTTPS exacte sans barre finale, puis `DATABASE_URL`.
- Exécuter `npm install`, `npx prisma generate` et `npm run db:deploy` sur la base cible. L’historique SQL dans `prisma/migrations/` est la source de vérité pour tous les objets métier. Les requêtes utilisent le client Prisma transactionnel. Ne pas utiliser `db push` pour synchroniser ce schéma.
- Créer le premier administrateur avec `npm run admin -- adresse@example.com "Nom complet"`. Transmettre le mot de passe sur l’entrée standard. Sous Bash, utiliser `read -rs PACKIO_PASSWORD; printf '%s' "$PACKIO_PASSWORD" | npm run admin -- adresse@example.com "Nom complet"; unset PACKIO_PASSWORD`. La route d’inscription publique ne crée que des clients.
- Pour développer le site Next.js, exécuter `npm run dev:next` et aligner `APP_URL` sur son URL. Pour Vercel, utiliser le preset Next.js et `npm run build`. Exécuter les migrations sur chaque base cible avant la première requête. Pour un serveur Node classique, utiliser `npm run build` puis `npm start`.
- Les fichiers privés (PNG, JPEG et PDF, 2 Mo par pièce) sont stockés dans la base, servis sur une route authentifiée avec téléchargement. Prévoir sauvegardes, stockage et volumétrie adaptés avant d’accueillir des clients. La messagerie utilise des événements serveur SSE avec reconnexion et relecture du fil.
- Compléter **Paramètres** avec l’identité de l’éditeur, les contacts, les conditions de vente et la notice de confidentialité. Les vues publiques reprennent ces contenus. Définir les dimensions des trois catégories et vérifier les adresses opérationnelles avant de prendre des commandes.

### Stripe Billing

1. Créer trois tarifs mensuels EUR dans Stripe et un tarif ponctuel de recharge. Les montants initiaux des abonnements sont 29,90 €, 69,90 € et 129,90 € pour 20, 55 et 120 crédits. La recharge initiale de développement est modifiable dans le back-office.
2. Configurer `STRIPE_SECRET_KEY` et `STRIPE_WEBHOOK_SECRET` côté serveur. Reporter chaque identifiant `price_…` dans la formule correspondante. Renseigner `topup_price`, `topup_cents` et `topup_credits`. Packio vérifie le prix, la devise et la périodicité avant de créer la session.
3. Configurer le portail client Stripe pour gérer paiements, annulations et changements de formule. Programmer les changements de formule à la prochaine échéance pour conserver la logique de crédits au cycle. Les coupons s’appliquent dans Stripe Checkout.
4. Créer le webhook `/api/stripe/webhook` au format snapshot, version **2024-06-20**, avec `invoice.paid`, `invoice.payment_failed`, `customer.subscription.deleted`, `checkout.session.completed`, `checkout.session.async_payment_succeeded` et `charge.refunded`. Le code exploite le schéma d’événements de cette version. Utiliser la clé de signature de cette destination.
5. Valider en mode test l’abonnement, le renouvellement, la recharge, l’échec de paiement et le remboursement avant toute activation live. Les remboursements sont initiés dans Stripe. Packio journalise leur montant, avertit l’administration et permet la régularisation motivée des crédits.

### E-mails et échéances

Définir `RESEND_API_KEY`, `EMAIL_FROM` sur un domaine vérifié et `CRON_SECRET`. Un ordonnanceur doit invoquer `GET /api/jobs` avec `Authorization: Bearer <CRON_SECRET>`, par exemple toutes les cinq minutes. Ce traitement notifie les retards et distribue les e-mails en attente avec une clé d’idempotence. Les préférences individuelles s’appliquent aux e-mails. Les alertes dans l’application sont écrites avec l’opération métier. Les notifications de suivi des transporteurs dépendent des étapes renseignées par le préparateur.

## Tests

`npm test` exécute les tests d’intégration. Sans `DATABASE_URL`, ils créent une base SQLite temporaire. Utiliser **une base PostgreSQL de test dédiée** pour les exécuter avec Prisma : ils créent des identités fictives et modifient des paramètres test. La CI démarre PostgreSQL 16, applique les migrations, exécute les tests, compile Next.js et exerce le parcours mobile avec Chromium. Les tests Stripe utilisent des événements signés localement ; une transaction avec un compte Stripe externe exige ses clés de test.

## Organisation

| Dossier | Responsabilité |
| --- | --- |
| `app/` | Entrées Next.js App Router et API |
| `lib/` | Comptes, permissions, transactions, crédits, Stripe et vues |
| `public/` | Interface des trois rôles et identité visuelle |
| `prisma/` | Schéma de connexion et migrations PostgreSQL |
| `extension/` | Extension Chrome Manifest V3 |
| `scripts/` | Serveur de développement, démo et administration |
| `tests/`, `browser/` | Intégration métier et parcours navigateur |

Les suivis de commandes et de transport sont manuels. Les API officielles multi-fournisseurs, la remontée automatique des ventes Vinted et la collecte automatique des étiquettes nécessitent une intégration autorisée distincte.
