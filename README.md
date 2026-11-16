# PACKIO

**Plateforme SaaS de logistique e-commerce déléguée.** Les vendeurs e-commerce, revendeurs Vinted et entrepreneurs confient la réception, le stockage et l'expédition de leurs commandes à un **préparateur attitré**, attribué manuellement par l'équipe Packio.

Trois espaces, une seule application :

| Espace | URL | Rôle |
| --- | --- | --- |
| Site public | `/` | Présentation, offres, FAQ, contact, pages légales |
| Client | `/client` | Commandes fournisseurs (stock ou dropshipping), stock et photos, expéditions et retours, ventes et comptes liés, crédits, messagerie, facturation |
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
- **Whop** pour les paiements (checkout hébergé, abonnements, crédits supplémentaires, webhooks signés Standard Webhooks)
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
| `nina.garnier@demo.packio.local` | Cliente Business **annuelle** en **retard** d'attribution (> 24 h) |
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
      webhooks/whop/       Webhooks Whop (signature vérifiée)
      uploads/  files/[id] Téléversement et téléchargement contrôlés
      realtime/            Flux SSE (messages, notifications)
      cron/[task]/         Tâches planifiées protégées par CRON_SECRET
      admin/export/        Exports CSV
  server/
    auth/                  Sessions, mots de passe, permissions, gardes
    services/              Logique métier transactionnelle (cœur du produit)
    billing/               Client API Whop, webhooks, mode démonstration
    actions/               Server Actions (validation Zod → services)
    storage/               Pilotes de stockage local / S3
  components/              UI (shadcn/ui, composants partagés, par espace)
  lib/                     Libellés, formatage, compatibilité, suivi transporteurs
tests/integration/         Tests Vitest sur PostgreSQL réel
tests/e2e/                 Parcours Playwright
```

**Principe** : toute écriture passe par un service de `src/server/services/` qui reçoit l'identité de l'utilisateur (`Actor`) et vérifie lui-même les droits. Les pages et actions appliquent en plus des gardes (`requireCustomer`, `requirePreparer`, `requireAdmin(permission)`). Les effets de bord (notifications, e-mails) ne sont émis qu'**après validation** de la transaction.

### Modèle de données (extrait)

`users`, `roles`, `sessions`, `customer_profiles`, `preparer_profiles`, `preparer_locations`, `preparer_assignments`, `preparer_absences`, `suppliers`, `plans`, `subscriptions`, `credit_packs`, `credit_wallets`, `credit_lots`, `credit_transactions`, `credit_reservations`, `supplier_orders`, `supplier_order_events`, `inbound_parcels`, `inventory_items`, `inventory_movements`, `inventory_counts`, `storage_purchases`, `outbound_shipments`, `shipment_items`, `shipment_events`, `shipment_classifications`, `parcel_size_rules`, `conversations`, `conversation_participants`, `conversation_access_grants`, `messages`, `notifications`, `notification_preferences`, `email_logs`, `payments`, `invoices`, `webhook_events`, `incidents`, `incident_updates`, `files`, `extension_tokens`, `marketplace_accounts`, `marketplace_listings`, `marketplace_sales`, `audit_logs`, `app_settings`, `contact_requests`.

Contraintes notables (migration `integrity_constraints`) :

- index partiel unique : **une seule affectation active par client** ;
- index partiels uniques : une seule réservation de crédits en cours et une seule capture par expédition (**anti double débit**) ;
- `CHECK` : soldes et quantités jamais négatifs ;
- **registres en ajout seul** (`credit_transactions`, `inventory_movements`, `audit_logs`, `shipment_events`, `supplier_order_events`) : un trigger interdit `UPDATE` et `DELETE`.

## Règles métier clés

### Inscription et attribution (exclusivement manuelle)

1. Le client crée son compte, choisit une offre et paie sur la page de paiement sécurisée Whop.
2. À l'activation (webhook) : compte actif, portefeuille crédité des crédits mensuels, état **« En attente d'attribution »**, échéance à 24 h (paramétrable), notification des administrateurs (et alerte immédiate si aucun préparateur n'a de capacité).
3. Le tableau de bord client affiche le message de bienvenue et le suivi du délai (souscription, temps écoulé, échéance, retard).
4. Un administrateur ouvre la fiche client → **Attribuer un préparateur** → choisit parmi les préparateurs (capacité clients et stockage, points de réception validés, absences) → confirme.
5. Résultat atomique : affectation enregistrée, client et préparateur notifiés, conversation privée créée, page d'adresse de réception activée, historique et journal d'audit.

**Aucun algorithme n'attribue de préparateur.** La tâche planifiée `/api/cron/attribution` se limite à passer les demandes en « Retard », alerter les administrateurs et informer le client. La réattribution conserve l'historique ; le transfert de stock est optionnel et refusé tant que des expéditions sont en cours de préparation.

### Points de réception et fournisseurs

Fournisseurs proposés par type de commande (réglable dans `Admin → Paramètres → Fournisseurs`, contrôlé côté serveur) : **commandes vers le stock** : ZenMarket, Vinted, Vestiaire Collective ; **dropshipping** : Temu, SHEIN, AliExpress.

Chaque point de réception indique le **téléphone à saisir sur les commandes** (Vinted l'exige) : par défaut celui du préparateur, modifiable par lieu. Le préparateur reçoit ainsi directement le SMS avec le code de retrait ; le formulaire de commande le rappelle au client dès qu'il choisit Vinted.

Seuls les lieux **validés par un administrateur** sont communiqués aux clients. Chaque fournisseur déclare les types de points (adresse professionnelle, locker, point relais) et les réseaux acceptés ; une commande vers un point incompatible est refusée. Les valeurs initiales sont volontairement prudentes et **doivent être vérifiées** dans `Admin → Paramètres → Fournisseurs`. Pour les lockers, le client transmet le **code de retrait** depuis la fiche de la commande (visible uniquement par lui et son préparateur). Chaque client dispose d'un **code client** (`PK-XXXXX`) à indiquer sur ses colis.

### Crédits

- Catégories : Petit (1 crédit), Moyen (2), Grand (3) — coûts et dimensions maximales **modifiables par l'administrateur**.
- **Seul le préparateur classe le colis**, dans les limites des règles ; le client peut contester (incident traité par l'administration, correction possible).
- À la classification : les crédits sont **réservés**. Solde insuffisant → « En attente de crédits » ; la demande reprend automatiquement après une recharge.
- Au **dépôt chez le transporteur** : débit définitif, idempotent (verrou de ligne + clé d'idempotence + index unique). Annulation avant préparation : crédits et stock libérés.
- Registre par **lots** : crédits mensuels consommés en priorité ; politiques distinctes et configurables (crédits mensuels : expiration au renouvellement ou report plafonné ; crédits achetés : sans expiration ou expiration après N jours).
- Les **frais de transport** sont distincts des crédits de préparation.

### Offres (valeurs initiales modifiables dans `Admin → Abonnements`)

| Offre | Mensuel | Annuel (1 mois offert) | Crédits / mois | Places de stockage |
| --- | --- | --- | --- | --- |
| Starter | 49 € / mois | 539 € / an (≈ 44,92 € / mois) | 20 | 5 articles |
| Pro | 95 € / mois | 1 045 € / an (≈ 87,08 € / mois) | 40 | 10 articles |
| Business | 179 € / mois | 1 969 € / an (≈ 164,08 € / mois) | 80 | 20 articles |

**Prix minimum d'un crédit : 1,90 €** en abonnement mensuel comme en recharge (Starter 2,45 €, Pro 2,38 €, Business 2,24 €, recharges de 1,99 € à 2,49 €). Le back-office refuse un prix inférieur ; seule la formule annuelle (1 mois offert) descend en dessous.

Les places de stockage correspondent au nombre d'articles stockés **en même temps** (voir [Stockage](#stockage)). Ce sont des valeurs par défaut, modifiables par offre ; une valeur modifiée dans le back-office n'est jamais écrasée par une migration. La formule mensuelle se renouvelle tous les **30 jours**, la formule annuelle tous les **365 jours** (périodes de facturation Whop). Un prix annuel vide dans le back-office retire la formule annuelle de l'offre.

**Formule annuelle** : payée en une fois, elle verse les crédits **chaque mois** (12 versements : le premier au paiement, les suivants le même jour des mois suivants) par la tâche planifiée `credits` (`/api/cron/credits`, toutes les heures), avec rattrapage si une exécution est manquée. Les règles d'expiration des crédits mensuels s'appliquent à chaque versement.

**Crédits supplémentaires** : en plus des crédits mensuels, le client peut acheter à tout moment **10, 30, 50 ou 100 crédits** (`Mes crédits → Acheter des crédits`, ou depuis le tableau de bord et les écrans d'expédition). Prix par défaut, modifiables dans `Admin → Abonnements` :

| Recharge | Prix | Prix par crédit |
| --- | --- | --- |
| 10 crédits | 24,90 € | 2,49 € |
| 30 crédits | 69,90 € | 2,33 € |
| 50 crédits | 109,90 € | 2,20 € |
| 100 crédits | 199 € | 1,99 € |

Seules ces quatre quantités sont acceptées (contrôle côté serveur). Les crédits achetés suivent leur propre politique d'expiration.

**Changement d'offre** (Whop ne facture pas de prorata et ne permet que de **baisser** le prix d'un abonnement existant) :

| Changement | Effet |
| --- | --- |
| Offre moins chère, même formule | Programmé au **prochain renouvellement**. Le nouveau prix est transmis à Whop 2 jours avant l'échéance (tâche `credits`) ; avant cela, le client peut l'annuler. |
| Offre plus chère, ou mensuel → annuel | **Immédiat** : nouveau paiement Whop. À l'activation, l'ancien abonnement n'est plus renouvelé (arrêt demandé à Whop, alerte administrateur en cas d'échec) ; ses crédits déjà versés restent utilisables et, pour un annuel, les mois restants continuent d'être versés. |
| Annuel → mensuel | À l'**échéance annuelle** : le renouvellement annuel est désactivé, puis le client active la formule mensuelle en un clic (notification et e-mail). Annulable avant l'échéance. |

### Stockage

Règles paramétrables (réglage `storage`, valeurs par défaut dans `src/server/services/settings.ts`) :

| Règle | Défaut |
| --- | --- |
| Durée incluse par article | 14 jours à compter de la mise en stock |
| Prolongation | 1 crédit **par article** pour 14 jours de plus, prélevé automatiquement |
| Rappel | 2 jours avant la fin de la durée payée |
| Places supplémentaires | 1 crédit = 3 places pendant 30 jours, ajoutées par le client depuis `Mon stock` |

- **Places** : articles en stock (disponibles ou réservés) + quantités des commandes en cours d'acheminement. Capacité = places de l'offre + places supplémentaires en cours de validité.
- **À la commande** : si la commande dépasse la capacité, le formulaire affiche les crédits nécessaires (places manquantes ÷ 5, arrondi au supérieur) ; le client doit **cocher son accord**, les places sont alors achetées et débitées dans la même transaction. Sans accord ou sans solde suffisant, la commande est refusée.
- **Durée** : la tâche `credits` envoie les rappels puis prélève les prolongations échues (idempotent par période, rattrapage si une exécution est manquée). Solde insuffisant → article **« en dépassement »** (client prévenu par e-mail, administrateurs alertés) ; la prolongation est prélevée dès que des crédits arrivent (recharge, renouvellement). Les articles réservés pour une expédition ne sont pas facturés.
- Les articles en **dropshipping** n'occupent aucune place et ne sont pas soumis à la durée de stockage.
- Les débits de stockage apparaissent dans l'historique des crédits (type « Stockage »).

### Expéditions : délai de 48 h et retour à domicile

- **Délai d'expédition** (réglage `shipping.slaHours`, 48 h par défaut) : chaque expédition reçoit une échéance à sa création. Le délai est suspendu pendant l'attente de crédits et repart à leur réservation. La tâche `attribution` (toutes les 15 min) alerte une fois le préparateur et les administrateurs pour chaque expédition non déposée à l'échéance.
- **Retour à domicile** : le client demande l'envoi d'articles à sa propre adresse (bouton « Me le renvoyer » sur la fiche article). Il paie le transport en joignant obligatoirement un **bordereau prépayé** (l'adresse du préparateur lui est indiquée comme expéditeur), et le retour coûte un **forfait de 1 crédit** (paramètre `shipping.returnCredits`, réglable dans Admin → Paramètres), réservé dès la demande et débité au dépôt, sans classification de taille ni contestation. Sans crédit disponible, le retour attend la recharge puis reprend automatiquement.

### Dropshipping

Pour un article déjà vendu (Vinted ou autre), le client le commande sur Temu, SHEIN ou AliExpress et déclare la commande en **dropshipping**, avec le bordereau de la vente ou, à défaut, l'adresse complète de l'acheteur. À la mise en stock par le préparateur, les articles sont marqués « dropshipping » et une expédition **express** (type « Dropshipping ») vers l'acheteur est créée automatiquement, avec le bordereau joint et l'échéance de 48 h. Aucune place n'est consommée.

### À vendre (photos produit)

Le préparateur dispose d'un espace **À vendre** (`/preparateur/a-vendre`) : les articles de ses clients à photographier, puis les photos publiées (badge dans la navigation). Les photos sont publiées dans l'espace **À vendre** du client (`/client/a-vendre`) : galerie par article, téléchargement (une photo ou toutes en ZIP), SKU à copier dans l'annonce et statut de l'annonce liée (à publier, en ligne, vendu). Le client est notifié. Les fichiers restent privés (accès contrôlé côté serveur).

### Bordereaux

Les bordereaux arrivent automatiquement dans l'espace **Bordereaux** du préparateur (`/preparateur/bordereaux`, badge dans la navigation) et du client (`/client/bordereaux`), chacun **à côté de l'article** à expédier (photo, SKU, emplacement) : bordereaux des ventes Vinted / Vestiaire Collective remontés par Packio Connect, des commandes en dropshipping et ceux joints aux demandes d'expédition. Le préparateur imprime ou télécharge le bordereau et voit l'échéance de 48 h ; le client voit aussi les ventes dont le bordereau n'est pas encore arrivé.

### Packio Connect (extension navigateur)

Extension Chrome (Manifest V3) fournie dans le dossier `extension/` — installation, configuration et limites dans [`extension/README.md`](extension/README.md). Elle relie les comptes **Vinted** et **Vestiaire Collective** du client à Packio : elle remonte ses annonces et ses ventes, puis le bordereau d'expédition de chaque vente.

- Le client connecte l'extension en un clic dans `Ventes et comptes liés` (bouton **Connecter l'extension**), ou crée un **jeton** manuel (affiché une seule fois, seul son hash est stocké, révocable).
- API utilisées par l'extension (en-tête `Authorization: Bearer <jeton>`) : `GET /api/extension/status`, `DELETE /api/extension/status` (déconnexion), `POST /api/extension/sync` (annonces et ventes), `POST /api/extension/label` (bordereau d'une vente, PDF ou image).
- **Toutes les ventes** des comptes liés s'affichent dans `Ventes et comptes liés` (filtres : toutes, à traiter, vendues avec Packio). Une vente d'une annonce rattachée à un article du stock (SKU cité dans l'annonce, ou rattachement manuel) part automatiquement chez le préparateur. Sous chaque autre vente : **Vendu avec Packio** (choix de l'article, expédition sous 48 h avec le bordereau) ou **Supprimer** (article expédié par le client lui-même : nom de l'acheteur et bordereau effacés, la vente n'est plus recréée ni son bordereau conservé). Les traitements sont idempotents (une vente rejouée ne crée rien de plus).
- Les plateformes ne proposent pas d'API officielle : la lecture des données dépend de leur site et doit être **validée avec de vrais comptes** ; le client l'utilise sur ses propres comptes et reste responsable du respect de leurs conditions d'utilisation.

## Sécurité et RGPD

- Sessions en base : jeton aléatoire de 256 bits dans un cookie `httpOnly`, `SameSite=Lax`, `Secure` en HTTPS ; seul le **hash SHA-256** est stocké. Mots de passe hachés avec **scrypt**.
- Limitation des tentatives de connexion (par e-mail et par IP), réinitialisation par lien à usage unique (1 h), invitations (7 jours).
- **Contrôle d'accès côté serveur partout** : un client ne voit que ses données ; un préparateur uniquement ses clients attribués et ses opérations ; l'administration selon des **permissions granulaires** (rôles `super_admin`, `operations`, `support`, rôles personnalisés).
- Fichiers **privés** : signature binaire vérifiée (le type déclaré est ignoré), 10 Mo maximum, téléchargement via `/api/files/[id]` après contrôle des droits (URL signée de 2 minutes en S3).
- Messagerie : l'administration n'accède aux conversations client / préparateur qu'avec un **motif**, pour une **durée limitée**, avec journalisation et **message système visible des participants**.
- Clé API Whop et secrets **uniquement côté serveur** ; aucune variable `NEXT_PUBLIC_` sensible. Les montants envoyés à Whop sont toujours recalculés par le serveur.
- Journal d'audit inaltérable des actions sensibles (crédits, attributions, remboursements, rôles, exports…).
- RGPD : export des données par le client (`Paramètres → Données personnelles`), demande de suppression, anonymisation par l'administration (registres préservés).
- En-têtes : `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`.

Les pages légales (`/legal/*`) sont des **modèles** alimentés par `Admin → Paramètres → Légal` ; les champs vides apparaissent en « [À compléter] ». **Faites-les valider par un professionnel du droit avant le lancement.**

## Configuration des services

Toutes les variables sont décrites dans [`.env.example`](.env.example).

### Paiements avec Whop

Packio utilise l'API Whop (`https://api.whop.com/api/v1`, ou `https://sandbox-api.whop.com/api/v1` avec `WHOP_ENVIRONMENT="sandbox"`) côté serveur uniquement.

1. Dans le tableau de bord Whop : **Developer → API keys**, créez une clé du compte → `WHOP_API_KEY`. Notez l'identifiant de l'entreprise (`biz_…`) → `WHOP_ACCOUNT_ID`.
2. Facultatif : créez un produit « Packio » (`prod_…`) → `WHOP_PRODUCT_ID` pour y rattacher les plans.
3. Plans : par défaut, Packio crée au moment du paiement un plan **masqué** au prix configuré dans le back-office (abonnement renouvelé tous les 30 jours ou tous les 365 jours pour la formule annuelle, ou paiement unique pour les crédits). Vous pouvez aussi créer vos plans dans Whop et coller leur identifiant (`plan_…`) dans `Admin → Abonnements` (plan mensuel et plan annuel de chaque offre, recharges) — le prix doit alors correspondre.
4. Webhook : **Developer → Webhooks**, URL `https://votre-domaine/api/webhooks/whop`, événements `payment.succeeded`, `payment.failed`, `membership.activated`, `membership.updated`, `refund.created`, `refund.updated`. Copiez le secret (`ws_…`) → `WHOP_WEBHOOK_SECRET`.
5. `BILLING_MODE="whop"`. Les codes promotionnels se créent dans le tableau de bord Whop et se saisissent sur la page de paiement.

Fonctionnement :

- Chaque paiement porte des métadonnées (`kind`, `packio_customer_id`, `plan_id` ou `pack_id`, `billing_interval`, et `replaces` pour un changement d'offre immédiat) qui permettent de rattacher l'abonnement Whop (`mem_…`) au client Packio ; l'identifiant utilisateur Whop est ensuite mémorisé.
- Le premier paiement d'un abonnement l'active et ouvre la demande d'attribution ; chaque paiement suivant est un renouvellement (crédits mensuels). La résiliation est programmée en fin de période ; un impayé passe le client en « paiement en retard » (Whop retente le prélèvement).
- La signature des webhooks suit le standard *Standard Webhooks* (HMAC-SHA256 du `webhook-id.webhook-timestamp.corps`, avec le secret tel quel, tolérance 5 minutes). Les événements sont journalisés dans `webhook_events` : un événement déjà traité est ignoré, un événement en échec renvoie un code 500 pour être renvoyé par Whop, puis retraité.
- Le bouton « Gérer mon paiement sur Whop » de la page Facturation renvoie vers la gestion de l'abonnement chez Whop (moyen de paiement, reçus, annulation).

À vérifier en environnement *sandbox* Whop avant le lancement : création des plans à la volée (mensuels et annuels), baisse du prix de renouvellement (offre inférieure), arrêt de l'ancien abonnement lors d'un changement immédiat, remboursements depuis le back-office.

### E-mails

Renseignez `RESEND_API_KEY` et `EMAIL_FROM` (domaine vérifié chez Resend). Sans clé, les e-mails sont enregistrés dans `email_logs` (visibles dans `Admin → Notifications`).

### Stockage des fichiers

En production serverless, le disque n'est pas persistant : utilisez `STORAGE_DRIVER="s3"` avec un bucket **privé** (ex. Cloudflare R2 ou Scaleway Object Storage pour un hébergement des fichiers dans l'UE).

### Tâches planifiées

`vercel.json` déclare :

| Route | Fréquence | Rôle |
| --- | --- | --- |
| `/api/cron/attribution` | toutes les 15 min | Retards d'attribution, alertes, information client ; expéditions non déposées dans le délai de 48 h |
| `/api/cron/credits` | toutes les heures | Expiration des lots de crédits échus, crédits mensuels de la formule annuelle, changements d'offre programmés, rappels et prolongations de stockage |
| `/api/cron/maintenance` | quotidien | Purge des sessions et jetons expirés |

Définissez `CRON_SECRET` : Vercel l'envoie en `Authorization: Bearer`. (Le plan Hobby de Vercel limite les crons à une exécution quotidienne : utilisez le plan Pro ou un ordonnanceur externe.)

## Déployer sur Render (recommandé)

Le fichier [`render.yaml`](render.yaml) décrit tout : le site (service web avec un disque de 5 Go pour les photos et bordereaux), la base PostgreSQL et une tâche planifiée toutes les 15 minutes (délais d'attribution et d'expédition, crédits, stockage, ménage quotidien). Région : Francfort.

**Première mise en ligne (site de démonstration, environ 10 minutes) :**

1. Créez un compte sur [render.com](https://render.com) avec votre compte GitHub, puis autorisez l'accès au dépôt `packio`.
2. **New → Blueprint**, choisissez le dépôt et la branche, puis **Apply**.
3. Render demande `INITIAL_ADMIN_EMAIL` : saisissez votre adresse e-mail.
4. Attendez la fin du premier déploiement. Dans **packio → Logs**, copiez le lien « Lien d'activation » affiché : il permet de choisir le mot de passe du compte super administrateur.
5. Vérifiez l'adresse du site (en haut de la page du service, par exemple `https://packio.onrender.com`). Si elle diffère, corrigez `APP_URL` dans **Env Groups → packio-commun**, puis **Manual Deploy**.

Ce premier site contient les **comptes de démonstration** (mot de passe `Demo-Packio-2026`) et des **paiements simulés** (aucun encaissement), comme en développement.

**Lancement réel :**

1. Créez une nouvelle base (ou un nouveau Blueprint) pour ne pas garder les données de démonstration.
2. Dans **packio → Environment** : supprimez `DEMO_DATA` et `ALLOW_DEV_BILLING_IN_PRODUCTION`, passez `BILLING_MODE` à `whop`, ajoutez `WHOP_API_KEY`, `WHOP_ACCOUNT_ID`, `WHOP_WEBHOOK_SECRET` (voir « Paiements avec Whop »), `RESEND_API_KEY` et `EMAIL_FROM` pour les e-mails, et `EXTENSION_STORE_URL` (lien de Packio Connect sur le Chrome Web Store).
3. Déclarez le webhook Whop sur `https://<votre-adresse>/api/webhooks/whop`.
4. Domaine personnalisé (facultatif) : **Settings → Custom Domains**, puis mettez `APP_URL` à jour.
5. Back-office → **Paramètres → Informations légales** : éditeur, et hébergeur « Render » avec l'adresse de la société indiquée sur render.com (reprise dans la politique de confidentialité).

Remarques : l'offre gratuite de Render n'est pas adaptée (le site s'endort après 15 minutes d'inactivité, la base gratuite expire après 30 jours, pas de disque ni de commande de pré-déploiement). Les plans indiqués dans `render.yaml` sont les plus petits plans payants ; le disque impose un court arrêt à chaque déploiement. Les noms de plans peuvent évoluer : en cas d'erreur à l'application du Blueprint, choisissez le plus petit plan payant proposé.

### Publier l'extension Packio Connect (Chrome Web Store)

L'extension publique est liée à **une seule adresse** du site : choisissez l'adresse définitive (domaine personnalisé compris) avant de la publier. Si l'adresse change ensuite, il faut reconstruire et republier l'extension.

1. Créez le paquet avec l'adresse du site :

```bash
npm run extension:build -- https://packio.onrender.com
```

2. Ouvrez un compte développeur sur la [console du Chrome Web Store](https://chrome.google.com/webstore/devconsole) (5 $, une fois), au nom de l'éditeur de Packio.
3. **Nouvel élément** : envoyez `dist/packio-connect-0.1.0.zip`, puis remplissez la fiche avec les textes et images de [`extension/store/`](extension/store/fiche-chrome-web-store.md) et soumettez-la à l'examen (quelques jours en général).
4. Une fois l'extension publiée, ajoutez `EXTENSION_STORE_URL` (adresse de la fiche) dans **packio → Environment**, puis redéployez : les clients voient le bouton **Installer depuis le Chrome Web Store**, puis **Connecter l'extension**, dans **Ventes et comptes liés**.

## Déploiement (Vercel)

1. Créez une base PostgreSQL managée (Neon, Supabase, Scaleway, RDS…). Utilisez l'URL **poolée** pour `DATABASE_URL` et, si nécessaire, l'URL directe pour `DIRECT_DATABASE_URL`.
2. Importez le dépôt sur Vercel et renseignez les variables d'environnement (`APP_URL` = domaine de production, `BILLING_MODE="whop"`, variables `WHOP_*`).
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

5. Configurez Whop (ci-dessus), puis dans le back-office : paramètres légaux, fournisseurs, préparateurs et leurs points de réception (à valider).

`npm run build` exécute `prisma generate` puis `next build`. Ne lancez **jamais** `npm run db:seed` en production (le script le refuse, sauf `DEMO_DATA=1` pour un site de démonstration assumé). `INITIAL_ADMIN_EMAIL` permet aussi de créer le compte propriétaire lors de `npm run db:bootstrap`.

## Tests

```bash
npm test
```

80 tests d'intégration sur une base PostgreSQL réelle (`packio_test`, migrée automatiquement), notamment :

- **crédits** : réservation / débit / libération, invariants du registre, 8 réservations concurrentes sérialisées, idempotence, politiques d'expiration et de report, ajustements administrateur, registre en ajout seul ;
- **attribution** : ouverture de la demande après paiement sans attribution automatique, alerte si aucun préparateur, capacité, points validés, attributions simultanées, réattribution avec transfert de stock et retrait d'accès, suivi du délai de 24 h ;
- **expéditions** : parcours complet, dépôt confirmé 3 fois en parallèle → un seul débit, attente puis reprise après recharge, reclassification, annulation, sur-réservation de stock, contestation et correction ;
- **webhooks Whop** : signature (vérifiée contre la bibliothèque Standard Webhooks de référence), activation, premier paiement, rejeu et doublons, renouvellement avec changement d'offre transmis (ou non) à Whop, impayé, résiliation, achat de crédits, remboursement, retraitement après échec, formule annuelle (métadonnées ou durée de période), remplacement d'abonnement ;
- **formule annuelle** : prix par défaut, paiement unique, 12 versements mensuels sans doublon avec rattrapage, renouvellement annuel, montée en gamme immédiate, passage à l'annuel, baisse programmée annulable, retour au mensuel à l'échéance ;
- **crédits supplémentaires** : uniquement 10, 30, 50 ou 100, achat, abonnement requis ;
- **permissions** : isolation entre clients, entre préparateurs, permissions administrateur, messagerie, fichiers.

Parcours de bout en bout (Playwright) — reproduit le parcours du cahier des charges : souscription Starter et paiement, message d'attente 24 h, attribution manuelle par l'administrateur, commande ZenMarket vers le stock, réception et mise en stock par le préparateur, demande d'expédition, classification (crédits réservés), préparation, étiquette, dépôt (crédits débités) avec suivi transporteur, messagerie client ↔ préparateur et supervision dans le back-office. Prérequis : base de développement initialisée (`npm run db:seed`) et `BILLING_MODE="dev"` ; le serveur de développement est démarré automatiquement s'il ne tourne pas.

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
- **Étiquettes d'expédition** : fournies par le client (ou récupérées par Packio Connect) ou téléversées par le préparateur ; la génération d'étiquettes via les API transporteurs est une évolution prévue.
- **Packio Connect** est en bêta : sans API officielle de Vinted et de Vestiaire Collective, la lecture des ventes et des bordereaux peut cesser de fonctionner si ces sites évoluent ; une publication sur le Chrome Web Store reste à faire.
- Les compatibilités fournisseurs / réseaux et les textes légaux sont des **valeurs initiales à vérifier** par l'exploitant.
