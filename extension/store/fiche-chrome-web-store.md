# Fiche Chrome Web Store : Packio Connect

Textes à copier dans la [console développeur du Chrome Web Store](https://chrome.google.com/webstore/devconsole), dans l'ordre des onglets. Remplacez `https://packio.onrender.com` par l'adresse réelle du site si elle est différente.

Ce dossier `store/` n'est pas inclus dans le paquet de l'extension.

---

## 1. Paquet

Fichier à envoyer : `dist/packio-connect-<version>.zip` (actuellement 0.2.2), créé par :

```bash
npm run extension:build -- https://packio.onrender.com
```

Pour chaque nouvelle version : augmentez `version` dans `extension/manifest.json` (par exemple `0.2.1`), reconstruisez le paquet, puis envoyez-le avec **Importer un nouveau package**.

---

## 2. Fiche Play Store (onglet « Fiche »)

**Langue** : français

**Nom** (repris du manifeste) : `Packio Connect`

**Résumé** (repris du manifeste, 132 caractères au maximum) :

> Relie vos comptes Vinted et Vestiaire Collective à Packio : ventes, expéditions et bordereaux transmis à votre préparateur.

**Description détaillée** :

```text
Packio Connect relie vos comptes Vinted et Vestiaire Collective à votre espace Packio, le service d'expédition déléguée pour les vendeurs en ligne.

Dès qu'un article vendu se trouve dans votre stock Packio :
• la vente est détectée automatiquement ;
• l'expédition est créée chez votre préparateur ;
• le bordereau généré par la plateforme lui est transmis, avec l'article à côté ;
• votre colis part sous 48 heures.

Installation en deux clics
1. Ajoutez l'extension à Chrome et acceptez la lecture de vos ventes (votre accord est demandé au premier lancement).
2. Dans Packio, ouvrez « Ventes et comptes liés » et cliquez sur « Connecter l'extension ».
Restez simplement connecté à Vinted ou Vestiaire Collective dans ce navigateur : la synchronisation a lieu toutes les 15 minutes, ou à la demande.

Vos ventes arrivent dans « Toutes mes ventes » : un clic pour choisir vente normale, vente dropshipping ou supprimer.

Données utilisées et confidentialité
• L'extension lit vos annonces (titre, description, prix, photo principale), vos ventes (article, prix, date, pseudonyme de l'acheteur, suivi) et les bordereaux d'expédition (nom et adresse de l'acheteur).
• Rien n'est lu avant votre accord, que vous pouvez retirer à tout moment dans les options.
• Si une page de ventes ne peut pas être lue, l'extrait est transmis à Packio pour une lecture de secours ; les données personnelles sont masquées avant tout recours à un service d'intelligence artificielle.
• L'extension utilise la session déjà ouverte dans votre navigateur : elle ne lit jamais vos mots de passe.
• Elle ne publie rien et ne modifie rien sur Vinted ou Vestiaire Collective.
• Les données sont envoyées uniquement à votre compte Packio, jamais vendues ni utilisées pour de la publicité.
• Vous pouvez déconnecter l'extension et révoquer son accès à tout moment depuis Packio.

Un compte Packio avec un abonnement actif est nécessaire.

Packio n'est ni affilié à Vinted ni à Vestiaire Collective. Vinted et Vestiaire Collective sont des marques de leurs propriétaires respectifs.
```

**Catégorie** : Productivité → Outils (ou la catégorie la plus proche proposée)

**Images** (dossier `store/images/`) :

| Champ | Fichier | Format exigé |
| --- | --- | --- |
| Icône | `extension/icons/icon128.png` | 128 × 128 |
| Captures d'écran (1 à 5) | `capture-1-connexion.png`, `capture-2-bordereaux.png`, `capture-3-fenetre.png` | 1280 × 800 |
| Petite vignette promotionnelle | `vignette-440x280.png` | 440 × 280 |

Les captures montrent les données de démonstration (personnes et ventes fictives).

**Site officiel** : `https://packio.onrender.com`

**Adresse d'assistance** : l'adresse e-mail de contact de Packio (ou le formulaire `https://packio.onrender.com/#contact`)

---

## 3. Pratiques de confidentialité (onglet « Confidentialité »)

**Objectif unique** :

```text
Transmettre au compte Packio de l'utilisateur les annonces et les ventes de ses propres comptes Vinted et Vestiaire Collective, avec leur bordereau d'expédition, afin que son préparateur Packio expédie les articles vendus.
```

**Justification des autorisations** :

| Autorisation | Justification à coller |
| --- | --- |
| `storage` | Conserver l'accord de l'utilisateur, le jeton de connexion au compte Packio, les préférences (site Vinted utilisé, plateformes à synchroniser) et le résumé de la dernière synchronisation. |
| `alarms` | Lancer la synchronisation automatique toutes les 15 minutes, pour que les ventes arrivent chez le préparateur sans action de l'utilisateur. |
| Autorisations d'hôte `vinted.*` | Lire, avec la session déjà ouverte par l'utilisateur, ses propres annonces, ventes et bordereaux d'expédition sur Vinted. Aucune écriture. |
| Autorisations d'hôte `vestiairecollective.com` | Lire, avec la session déjà ouverte par l'utilisateur, ses propres annonces, ventes et bordereaux d'expédition sur Vestiaire Collective. Aucune écriture. |
| Autorisation d'hôte du site Packio | Envoyer les annonces, ventes et bordereaux au compte Packio de l'utilisateur, seul destinataire des données. |
| Script de contenu sur la page « Ventes » de Packio | Permettre la connexion en un clic : la page Packio transmet à l'extension le jeton de l'utilisateur connecté, sans copier-coller. |

**Code distant** : Non, je n'utilise pas de code distant. (Tout le code est inclus dans le paquet.)

**Données collectées** : cochez

- Informations personnelles : nom ou pseudonyme de l'acheteur, adresse figurant sur le bordereau ;
- Informations d'authentification : jeton de connexion Packio ;
- Informations financières et de paiement : historique des ventes (prix, dates) ;
- Contenu du site Web : annonces (titre, description, prix, photo principale).

**Déclarations** : cochez les trois cases

- Je ne vends ni ne transfère de données utilisateur à des tiers, en dehors des cas d'utilisation approuvés.
- Je n'utilise ni ne transfère de données utilisateur à des fins sans rapport avec l'objectif unique de mon article.
- Je n'utilise ni ne transfère de données utilisateur pour déterminer la solvabilité ou à des fins de prêt.

**Règles de confidentialité (URL)** : `https://packio.onrender.com/legal/confidentialite`

---

## 4. Distribution (onglet « Distribution »)

- **Paiement** : sans frais.
- **Visibilité** : **Publique** (trouvable dans le Chrome Web Store), ou **Non répertoriée** pour qu'elle ne soit accessible que par le lien affiché dans Packio.
- **Régions** : toutes, ou au moins France, Belgique, Espagne, Italie, Allemagne (pays Vinted pris en charge).

---

## 5. Après la publication

1. Copiez l'adresse de la fiche (`https://chromewebstore.google.com/detail/packio-connect/<identifiant>`).
2. Dans Render, ajoutez la variable `EXTENSION_STORE_URL` avec cette adresse sur le service `packio`, puis redéployez : le bouton **Installer depuis le Chrome Web Store** apparaît dans « Ventes et comptes liés ».

## Points d'attention pour l'examen par Google

- Le premier examen prend en général de quelques jours à deux semaines ; les autorisations d'hôte larges l'allongent.
- Le compte développeur coûte 5 $ une fois. Il doit être au nom de l'éditeur de Packio, avec une adresse e-mail vérifiée.
- L'examinateur doit pouvoir tester : dans **Instructions de test**, indiquez un compte de démonstration du site (par exemple `lea.moreau@demo.packio.local` si les données de démonstration sont actives) et la marche à suivre ci-dessus. Ne supprimez pas les données de démonstration avant la fin de l'examen.
- Règles 2026 du Chrome Web Store : l'extension affiche au premier lancement ce qu'elle lit et pourquoi, et ne lit rien avant l'accord (« J'accepte »), révocable dans ses options. La politique de confidentialité du site contient la déclaration d'utilisation limitée.
- Compte développeur : déclarez le statut de **commerçant** (Trader) si Packio est exploité par une entreprise ; le nom, l'adresse, le téléphone et l'e-mail vérifiés sont affichés sur la fiche.
- Avant la publication réelle, validez les adresses Vinted et Vestiaire marquées `À VÉRIFIER` dans `platforms/` avec un vrai compte (voir `extension/README.md`).
