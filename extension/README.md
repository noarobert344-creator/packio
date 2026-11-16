# Packio Connect (extension de navigateur)

Packio Connect relie les comptes **Vinted** et **Vestiaire Collective** d'un client Packio à son espace :

- les **annonces** sont synchronisées et rattachées automatiquement à un article du stock quand leur description cite le SKU Packio (`SKU-XXXXXXX`) ;
- chaque **vente** détectée sur un article stocké crée l'expédition chez le préparateur ;
- le **bordereau** généré par la plateforme est transmis automatiquement et joint à l'expédition : le préparateur n'a plus qu'à l'imprimer.

Version 0.2.2 : extension Chrome (Manifest V3), sans étape de compilation. Si une plateforme change la structure de ses ventes, l'extension confie l'extrait illisible à la lecture de secours de Packio (côté serveur : lecture automatique gratuite, puis IA facultative ; voir le README principal).

## Installation pour les clients (version publique)

1. Installer **Packio Connect** depuis le Chrome Web Store (bouton dans Packio, page **Ventes et comptes liés**). Fonctionne aussi avec Edge et Brave.
2. Dans Packio, page **Ventes et comptes liés**, cliquer sur **Connecter l'extension** : la page crée un jeton personnel et le transmet à l'extension, sans copier-coller.
3. Rester connecté à Vinted et/ou Vestiaire Collective dans ce navigateur. La synchronisation a lieu toutes les 15 minutes, ou à la demande (**Synchroniser maintenant** dans la fenêtre de l'extension).

Une nouvelle connexion depuis le même navigateur révoque l'ancien jeton. Le bouton **Déconnecter ce navigateur de Packio** (options de l'extension) révoque le jeton et arrête tout envoi.

## Construire la version publique

```bash
npm run extension:build -- https://packio.onrender.com
```

Le script (`scripts/build-extension.mjs`) copie ce dossier dans `dist/packio-connect/`, puis :

- inscrit l'adresse de Packio dans `config.js` (champ non modifiable dans les options) ;
- déclare l'accès à cette seule adresse (`host_permissions`) et retire l'accès optionnel à tous les sites ;
- limite le script de connexion `connect.js` à la page `/client/ventes` de cette adresse ;
- crée l'archive `dist/packio-connect-<version>.zip` à envoyer sur le Chrome Web Store.

Fiche, textes de confidentialité, justification des autorisations et images : [`store/fiche-chrome-web-store.md`](store/fiche-chrome-web-store.md). Le dossier `store/` n'est pas inclus dans le paquet.

Une fois l'extension publiée, renseigner son adresse dans la variable `EXTENSION_STORE_URL` du site : le bouton d'installation apparaît dans Packio.

## Développement (mode développeur)

- **Connexion en un clic** : `npm run extension:build -- http://localhost:3000`, puis dans `chrome://extensions`, activer le **mode développeur** et **Charger l'extension non empaquetée** en choisissant `dist/packio-connect/`.
- **Connexion manuelle** : charger directement ce dossier `extension/` (aucune adresse intégrée). Dans les options, saisir l'adresse de Packio et un jeton personnel créé dans **Ventes et comptes liés → Connexion manuelle**. Chrome demande alors l'autorisation de joindre cette adresse.

## Données lues et transmises

L'extension lit, avec la session déjà ouverte dans votre navigateur :

- votre identifiant et votre pseudo sur la plateforme ;
- vos annonces (titre, description, prix, lien, photo principale, statut) ;
- vos ventes (référence, article, prix, pseudo de l'acheteur, date) ;
- le bordereau d'expédition de chaque vente, lorsqu'il a été généré.

Elle ne lit **jamais** vos identifiants, ne publie rien et ne modifie rien sur les plateformes. Les données sont envoyées uniquement à l'adresse de Packio configurée, avec votre jeton. Le jeton peut être révoqué à tout moment dans Packio.

## Avertissement

Vinted et Vestiaire Collective ne proposent pas d'API ouverte aux vendeurs particuliers, et leurs conditions d'utilisation peuvent restreindre les outils automatisés. Vous utilisez cette extension sur **vos propres comptes, sous votre responsabilité**. Les plateformes peuvent modifier leur site à tout moment, ce qui peut interrompre la synchronisation.

## Organisation du code

| Fichier | Rôle |
| --- | --- |
| `manifest.json` | Déclaration (permissions : `storage`, `alarms`, sites Vinted et Vestiaire ; l'accès à Packio est ajouté par le script de construction, ou demandé dans les options en développement) |
| `config.js` | Adresse de Packio intégrée à la version publique (vide dans ce dossier) |
| `connect.js` | Script de la page « Ventes » de Packio : détection de l'extension et connexion en un clic (origine vérifiée) |
| `background.js` | Service worker : connexion en un clic, synchronisation planifiée et à la demande, envoi des bordereaux, journal de la dernière synchronisation |
| `platforms/vinted.js`, `platforms/vestiaire.js` | Toutes les adresses et correspondances de champs propres à chaque plateforme |
| `platforms/common.js` | Requêtes avec la session du navigateur, conversions de prix et de dates |
| `popup.*`, `options.*`, `styles.css` | Interface de l'extension |

API Packio utilisée (authentification `Authorization: Bearer pkx_…`) : `GET /api/extension/status`, `DELETE /api/extension/status` (déconnexion : révoque le jeton présenté), `POST /api/extension/sync`, `POST /api/extension/label`, `POST /api/extension/ai-extract` (lecture de secours).

## À valider avec un vrai compte avant la mise en production

Les adresses des plateformes ne sont pas documentées publiquement. Chaque point marqué `À VÉRIFIER` dans `platforms/` doit être contrôlé, onglet **Réseau** des outils de développement ouvert sur les pages du site :

**Vinted**

1. Utilisateur connecté : `GET /api/v2/users/current` (réponse `{ user: { id, login } }`).
2. Dressing : `GET /api/v2/wardrobe/{id}/items?page=…&per_page=…` (champs `is_closed`, `is_reserved`, `is_hidden`, `price`, `photos`).
3. Ventes : `GET /api/v2/my_orders?type=sold&status=all` (clé `my_orders`, `transaction_id`, `item_id`, pseudo de l'acheteur).
4. Bordereau : `GET /api/v2/transactions/{id}` puis `GET /api/v2/shipments/{shipmentId}/label_url`.
5. En-têtes éventuellement exigés (jeton CSRF, identifiant anonyme) et limites de fréquence.

**Vestiaire Collective** (tout est à vérifier)

1. Utilisateur connecté : `GET https://apiv2.vestiairecollective.com/users/me`.
2. Articles en vente : `GET /users/{id}/products`.
3. Ventes : `GET /orders/sales` et URL du bordereau (`shippingLabelUrl`).
4. Mode d'authentification : si l'API exige un jeton lu dans le stockage du site, ajouter un script de contenu sur `vestiairecollective.com`.

Publier ou mettre à jour l'extension une fois ces points validés (voir « Construire la version publique »).
