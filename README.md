# PACKIO

**Plateforme SaaS de logistique e-commerce déléguée.** Les vendeurs e-commerce, revendeurs Vinted et entrepreneurs confient la réception, le stockage et l'expédition de leurs commandes à un **préparateur attitré**, attribué manuellement par l'équipe Packio.

Trois espaces, une seule application :

| Espace | URL | Rôle |
| --- | --- | --- |
| Site public | `/` | Présentation, offres, FAQ, contact, pages légales |
| Client | `/client` | Commandes fournisseurs, stock, expéditions, crédits, messagerie, facturation |
| Préparateur | `/preparateur` | Réceptions, stock, classification et expédition des colis, incidents |
| Super administrateur | `/admin` | Clients, préparateurs, attributions, opérations, revenus, paramètres, audit |

---

## Sommaire

1. [Stack technique](#stack-technique)
2. [Démarrage rapide (développement)](#démarrage-rapide-développement)
3. [Architecture](#architecture)
4. [Règles métier clés](#règles-métier-clés)
5. [Sécurité et RGPD](#sécurité-et-rgpd)
6. [Configuration des services](#configuration-des-services)
7. [Déploiement (Vercel)](#déploiement-vercel)
8. [Tests](#tests)
9. [Scripts npm](#scripts-npm)
10. [Limites connues et évolutions](#limites-connues-et-évolutions)

---

## Stack technique

- **Next.js 16** (App Router, Server Components, Server Actions, `proxy.ts`), **React 19**, **TypeScript strict**
- **Tailwind CSS 4**, **shadcn/ui** (Radix), icônes **Lucide**, police **Geist**, **thème sombre par défaut** (bascule clair / sombre mémorisée)
- **PostgreSQL 16** + **Prisma ORM 7** (adaptateur `pg`, migrations versionnées)
- **Stripe Billing** (Checkout, portail client, webhooks signés)
- **Resend** pour les e-mails transactionnels (journalisation en développement)
- Stockage de fichiers **privé** : disque local (dev) ou **S3 compatible** (AWS S3, Cloudflare R2, Scaleway…)
- Temps réel par **Server-Sent Events** (compatible serverless)
- **Vitest** (tests d'intégration sur base réelle) et **Playwright** (parcours de bout en bout)

## Démarrage rapide (développement)

Prérequis : Node.js ≥ 20.9, PostgreSQL 16 (ou Docker).

```bash
docker compose up -d
```

```bash
cp .env.example .env
```

```bash
npm install
```

```bash
npm run db:migrate
```

```bash
npm run db:seed
```

```bash
npm run dev
```

L'application est disponible sur <http://localhost:3000>.

### Comptes de démonstration (développement uniquement)

Le seed refuse de s'exécuter en production et sur une base distante. Tous les comptes sont en `@demo.packio.local`, marqués `isDemo` (badge « Démo » dans le back-office) et un bandeau « Environnement de démonstration » s'affiche dans l'application. Mot de passe commun : `Demo-Packio-2026`.

| Compte | Situation |
| --- | --- |
| `admin@demo.packio.local` | Super administrateur |
| `camille.martin@demo.packio.local` | Préparatrice (Lyon) avec locker InPost et adresse professionnelle validés |
| `yanis.benali@demo.packio.local` | Préparateur (Lille) |
| `lea.moreau@demo.packio.local` | Cliente Pro attribuée, avec commandes, stock, expéditions et messages |
| `hugo.petit@demo.packio.local` | Client Starter en attente d'attribution (5 h) |
| `nina.garnier@demo.packio.local` | Cliente Business en **retard** d'attribution (> 24 h) |
| `tom.roux@demo.packio.local` | Compte créé, abonnement non payé |

Avec `BILLING_MODE="dev"`, les paiements sont **simulés** (écran `/paiement-demo`, aucune carte demandée) et la page Facturation propose des outils pour simuler un renouvellement mensuel ou un échec de paiement.

## Architecture

```
prisma/
  schema.prisma            Modèle de données complet (≈ 40 tables)
  migrations/              Migrations SQL versionnées (dont contraintes d'intégrité)
  seed.ts                  Données de démonstration (développement uniquement)
scripts/
  bootstrap.ts             Données de référence (production comprise)
  create-admin.ts          Création du super administrateur
src/
  proxy.ts                 Redirection optimiste + en-têtes de sécurité
  app/
    (marketing)/           Site public, pages légales
    (auth)/                Connexion, inscription, mot de passe, invitation
    client/                Espace client
    preparateur/           Espace préparateur
    admin/                 Back-office super administrateur
    paiement-demo/         Paiement simulé (BILLING_MODE=dev uniquement)
    api/
      webhooks/stripe/     Webhooks Stripe (signature vérifiée)
      uploads/  files/[id] Téléversement et téléchargement contrôlés
      realtime/            Flux SSE (messages, notifications)
      cron/[task]/         Tâches planifiées protégées par CRON_SECRET
      admin/export/        Exports CSV
  server/
    auth/                  Sessions, mots de passe, permissions, gardes
    services/              Logique métier transactionnelle (cœur du produit)
    billing/               Stripe, webhooks, mode démonstration
    actions/               Server Actions (validation Zod → services)
    storage/               Pilotes de stockage local / S3
  components/              UI (shadcn/ui, composants partagés, par espace)
  lib/                     Libellés, formatage, compatibilité, suivi transporteurs
tests/integration/         Tests Vitest sur PostgreSQL réel
tests/e2e/                 Parcours Playwright
```

**Principe** : toute écriture passe par un service de `src/server/services/` qui reçoit l'identité de l'utilisateur (`Actor`) et vérifie lui-même les droits. Les pages et actions appliquent en plus des gardes (`requireCustomer`, `requirePreparer`, `requireAdmin(permission)`). Les effets de bord (notifications, e-mails) ne sont émis qu'**après validation** de la transaction.

### Modèle de données (extrait)

`users`, `roles`, `sessions`, `customer_profiles`, `preparer_profiles`, `preparer_locations`, `preparer_assignments`, `preparer_absences`, `suppliers`, `plans`, `subscriptions`, `credit_packs`, `credit_wallets`, `credit_lots`, `credit_transactions`, `credit_reservations`, `supplier_orders`, `supplier_order_events`, `inbound_parcels`, `inventory_items`, `inventory_movements`, `inventory_counts`, `outbound_shipments`, `shipment_items`, `shipment_events`, `shipment_classifications`, `parcel_size_rules`, `conversations`, `conversation_participants`, `conversation_access_grants`, `messages`, `notifications`, `notification_preferences`, `email_logs`, `payments`, `invoices`, `stripe_events`, `incidents`, `incident_updates`, `files`, `audit_logs`, `app_settings`, `contact_requests`.

Contraintes notables (migration `integrity_constraints`) :

- index partiel unique : **une seule affectation active par client** ;
- index partiels uniques : une seule réservation de crédits en cours et une seule capture par expédition (**anti double débit**) ;
- `CHECK` : soldes et quantités jamais négatifs ;
- **registres en ajout seul** (`credit_transactions`, `inventory_movements`, `audit_logs`, `shipment_events`, `supplier_order_events`) : un trigger interdit `UPDATE` et `DELETE`.

## Règles métier clés

### Inscription et attribution (exclusivement manuelle)

1. Le client crée son compte, choisit une offre et paie (Stripe Checkout).
2. À l'activation (webhook) : compte actif, portefeuille crédité des crédits mensuels, état **« En attente d'attribution »**, échéance à 24 h (paramétrable), notification des administrateurs (et alerte immédiate si aucun préparateur n'a de capacité).
3. Le tableau de bord client affiche le message de bienvenue et le suivi du délai (souscription, temps écoulé, échéance, retard).
4. Un administrateur ouvre la fiche client → **Attribuer un préparateur** → choisit parmi les préparateurs (capacité clients et stockage, points de réception validés, absences) → confirme.
5. Résultat atomique : affectation enregistrée, client et préparateur notifiés, conversation privée créée, page d'adresse de réception activée, historique et journal d'audit.

**Aucun algorithme n'attribue de préparateur.** La tâche planifiée `/api/cron/attribution` se limite à passer les demandes en « Retard », alerter les administrateurs et informer le client. La réattribution conserve l'historique ; le transfert de stock est optionnel et refusé tant que des expéditions sont en cours de préparation.

### Points de réception et fournisseurs

Seuls les lieux **validés par un administrateur** sont communiqués aux clients. Chaque fournisseur déclare les types de points (adresse professionnelle, locker, point relais) et les réseaux acceptés ; une commande vers un point incompatible est refusée. Les valeurs initiales sont volontairement prudentes et **doivent être vérifiées** dans `Admin → Paramètres → Fournisseurs`. Pour les lockers, le client transmet le **code de retrait** depuis la fiche de la commande (visible uniquement par lui et son préparateur). Chaque client dispose d'un **code client** (`PK-XXXXX`) à indiquer sur ses colis.

### Crédits

- Catégories : Petit (1 crédit), Moyen (2), Grand (3) — coûts et dimensions maximales **modifiables par l'administrateur**.
- **Seul le préparateur classe le colis**, dans les limites des règles ; le client peut contester (incident traité par l'administration, correction possible).
- À la classification : les crédits sont **réservés**. Solde insuffisant → « En attente de crédits » ; la demande reprend automatiquement après une recharge.
- Au **dépôt chez le transporteur** : débit définitif, idempotent (verrou de ligne + clé d'idempotence + index unique). Annulation avant préparation : crédits et stock libérés.
- Registre par **lots** : crédits mensuels consommés en priorité ; politiques distinctes et configurables (crédits mensuels : expiration au renouvellement ou report plafonné ; crédits achetés : sans expiration ou expiration après N jours).
- Les **frais de transport** sont distincts des crédits de préparation.

### Offres (valeurs initiales modifiables dans `Admin → Abonnements`)

| Offre | Prix | Crédits / mois | Stockage |
| --- | --- | --- | --- |
| Starter | 29,90 € / mois | 20 | 50 articles |
| Pro | 69,90 € / mois | 55 | 200 articles |
| Business | 129,90 € / mois | 120 | 600 articles |

Les limites de stockage et les recharges (10, 30, 60 crédits) sont des valeurs par défaut à ajuster.

**Crédits supplémentaires** : en plus des crédits mensuels, le client peut acheter à tout moment (`Mes crédits → Acheter des crédits`, ou depuis le tableau de bord et les écrans d'expédition) :

- des **recharges prêtes à l'emploi** (lots dégressifs, gérés dans `Admin → Abonnements`) ;
- une **quantité libre** au prix unitaire configuré dans `Admin → Crédits` (par défaut 1,99 € le crédit, de 5 à 500 crédits par achat, désactivable).

Le prix est toujours recalculé côté serveur ; le paiement passe par Stripe Checkout (codes promo acceptés, facture émise) et les crédits achetés suivent leur propre politique d'expiration.

## Sécurité et RGPD

- Sessions en base : jeton aléatoire de 256 bits dans un cookie `httpOnly`, `SameSite=Lax`, `Secure` en HTTPS ; seul le **hash SHA-256** est stocké. Mots de passe hachés avec **scrypt**.
- Limitation des tentatives de connexion (par e-mail et par IP), réinitialisation par lien à usage unique (1 h), invitations (7 jours).
- **Contrôle d'accès côté serveur partout** : un client ne voit que ses données ; un préparateur uniquement ses clients attribués et ses opérations ; l'administration selon des **permissions granulaires** (rôles `super_admin`, `operations`, `support`, rôles personnalisés).
- Fichiers **privés** : signature binaire vérifiée (le type déclaré est ignoré), 10 Mo maximum, téléchargement via `/api/files/[id]` après contrôle des droits (URL signée de 2 minutes en S3).
- Messagerie : l'administration n'accède aux conversations client / préparateur qu'avec un **motif**, pour une **durée limitée**, avec journalisation et **message système visible des participants**.
- Clés Stripe et secrets **uniquement côté serveur** ; aucune variable `NEXT_PUBLIC_` sensible.
- Journal d'audit inaltérable des actions sensibles (crédits, attributions, remboursements, rôles, exports…).
- RGPD : export des données par le client (`Paramètres → Données personnelles`), demande de suppression, anonymisation par l'administration (registres préservés).
- En-têtes : `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`.

Les pages légales (`/legal/*`) sont des **modèles** alimentés par `Admin → Paramètres → Légal` ; les champs vides apparaissent en « [À compléter] ». **Faites-les valider par un professionnel du droit avant le lancement.**

## Configuration des services

Toutes les variables sont décrites dans [`.env.example`](.env.example).

### Stripe Billing

1. Renseignez `STRIPE_SECRET_KEY` et `BILLING_MODE="stripe"`.
2. Dans `Admin → Abonnements`, cliquez **Synchroniser avec Stripe** sur chaque offre (création du produit et du prix mensuel ; un changement de prix crée un nouveau prix, les abonnés existants conservent le leur).
3. Créez un endpoint webhook vers `https://votre-domaine/api/webhooks/stripe` avec les événements :
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `customer.subscription.paused`, `customer.subscription.resumed`, `invoice.paid`, `invoice.payment_failed`, `invoice.finalized`, `invoice.updated`, `invoice.voided`, `invoice.marked_uncollectible`, `charge.refunded`.
4. Copiez le secret de signature dans `STRIPE_WEBHOOK_SECRET`.
5. Activez le **portail client** Stripe (moyens de paiement, factures) et, si besoin, **Stripe Tax** (`STRIPE_AUTOMATIC_TAX="1"`). Les prix sont créés **TTC** (`tax_behavior: inclusive`).

Test local :

```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

Les webhooks sont journalisés dans `stripe_events` : un événement déjà traité est ignoré, un événement en échec renvoie un code 500 pour être renvoyé par Stripe, puis retraité.

### E-mails

Renseignez `RESEND_API_KEY` et `EMAIL_FROM` (domaine vérifié chez Resend). Sans clé, les e-mails sont enregistrés dans `email_logs` (visibles dans `Admin → Notifications`).

### Stockage des fichiers

En production serverless, le disque n'est pas persistant : utilisez `STORAGE_DRIVER="s3"` avec un bucket **privé** (ex. Cloudflare R2 ou Scaleway Object Storage pour un hébergement des fichiers dans l'UE).

### Tâches planifiées

`vercel.json` déclare :

| Route | Fréquence | Rôle |
| --- | --- | --- |
| `/api/cron/attribution` | toutes les 15 min | Retards d'attribution, alertes, information client |
| `/api/cron/credits` | toutes les heures | Expiration des lots de crédits échus |
| `/api/cron/maintenance` | quotidien | Purge des sessions et jetons expirés |

Définissez `CRON_SECRET` : Vercel l'envoie en `Authorization: Bearer`. (Le plan Hobby de Vercel limite les crons à une exécution quotidienne : utilisez le plan Pro ou un ordonnanceur externe.)

## Déploiement (Vercel)

1. Créez une base PostgreSQL managée (Neon, Supabase, Scaleway, RDS…). Utilisez l'URL **poolée** pour `DATABASE_URL` et, si nécessaire, l'URL directe pour `DIRECT_DATABASE_URL`.
2. Importez le dépôt sur Vercel et renseignez les variables d'environnement (`APP_URL` = domaine de production, `BILLING_MODE="stripe"`).
3. Appliquez les migrations et les données de référence (depuis la CI ou un poste disposant de l'URL directe) :

```bash
npm run db:migrate
```

```bash
npm run db:bootstrap
```

4. Créez le compte propriétaire (lien d'activation envoyé par e-mail et affiché) :

```bash
npm run admin:create -- --email vous@votre-domaine.fr --first Prénom --last Nom
```

5. Configurez Stripe (ci-dessus), puis dans le back-office : paramètres légaux, fournisseurs, préparateurs et leurs points de réception (à valider).

`npm run build` exécute `prisma generate` puis `next build`. Ne lancez **jamais** `npm run db:seed` en production (le script le refuse).

## Tests

```bash
npm test
```

46 tests d'intégration sur une base PostgreSQL réelle (`packio_test`, migrée automatiquement) :

- **crédits** : réservation / débit / libération, invariants du registre, 8 réservations concurrentes sérialisées, idempotence, politiques d'expiration et de report, ajustements administrateur, registre en ajout seul ;
- **attribution** : ouverture de la demande après paiement sans attribution automatique, alerte si aucun préparateur, capacité, points validés, attributions simultanées, réattribution avec transfert de stock et retrait d'accès, suivi du délai de 24 h ;
- **expéditions** : parcours complet, dépôt confirmé 3 fois en parallèle → un seul débit, attente puis reprise après recharge, reclassification, annulation, sur-réservation de stock, contestation et correction ;
- **webhooks Stripe** : signature, activation, rejeu et doublons, renouvellement, changement d'offre, impayé, recharge, remboursement, retraitement après échec ;
- **permissions** : isolation entre clients, entre préparateurs, permissions administrateur, messagerie, fichiers.

Parcours de bout en bout (Playwright) — reproduit le parcours du cahier des charges : souscription Starter et paiement, message d'attente 24 h, attribution manuelle par l'administrateur, commande AliExpress, réception et mise en stock par le préparateur, demande d'expédition, classification (crédits réservés), préparation, étiquette, dépôt (crédits débités) avec suivi transporteur, messagerie client ↔ préparateur et supervision dans le back-office. Prérequis : base de développement initialisée (`npm run db:seed`) et `BILLING_MODE="dev"` ; le serveur de développement est démarré automatiquement s'il ne tourne pas.

```bash
npm run test:e2e
```

## Scripts npm

| Script | Description |
| --- | --- |
| `dev` / `build` / `start` | Next.js |
| `typecheck` | Types de routes Next + `tsc --noEmit` |
| `lint` | ESLint |
| `test` / `test:e2e` | Vitest / Playwright |
| `db:migrate` | Applique les migrations (`prisma migrate deploy`) |
| `db:migrate:dev` | Crée une migration en développement |
| `db:seed` | Données de démonstration (développement uniquement) |
| `db:bootstrap` | Données de référence (idempotent, production comprise) |
| `admin:create` | Crée ou promeut le super administrateur |

## Limites connues et évolutions

- **Commandes fournisseurs** saisies manuellement (V1). L'architecture permet d'ajouter des connecteurs API officiels lorsque les fournisseurs les proposent et les autorisent.
- **Suivi transporteurs** : liens de suivi publics générés automatiquement ; les statuts « En transit / Livré » sont mis à jour par le préparateur. Un connecteur d'API officielle (ex. La Poste / Colissimo) peut être branché sur `src/lib/tracking.ts`.
- **Temps réel** : SSE avec interrogation légère de la base (≈ 2,5 s) ; pour un très grand nombre d'utilisateurs simultanés, remplacer par un service pub/sub (Pusher, Ably, Redis).
- **Étiquettes d'expédition** : fournies par le client ou téléversées par le préparateur ; la génération d'étiquettes via les API transporteurs est une évolution prévue.
- Les compatibilités fournisseurs / réseaux et les textes légaux sont des **valeurs initiales à vérifier** par l'exploitant.
