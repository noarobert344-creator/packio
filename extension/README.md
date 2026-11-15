# Packio Connect (extension de navigateur)

Packio Connect relie les comptes **Vinted** et **Vestiaire Collective** d'un client Packio à son espace :

- les **annonces** sont synchronisées et rattachées automatiquement à un article du stock quand leur description cite le SKU Packio (`SKU-XXXXXXX`) ;
- chaque **vente** détectée sur un article stocké crée l'expédition chez le préparateur ;
- le **bordereau** généré par la plateforme est transmis automatiquement et joint à l'expédition : le préparateur n'a plus qu'à l'imprimer.

Version 0.1.0 : extension Chrome (Manifest V3), sans étape de compilation.

## Installation (mode développeur)

1. Ouvrez `chrome://extensions` dans Chrome (ou Edge, Brave : même principe).
2. Activez le **mode développeur** (en haut à droite).
3. Cliquez sur **Charger l'extension non empaquetée** et choisissez ce dossier `extension/`.
4. La page d'options s'ouvre :
   - **Adresse de Packio** : l'adresse de l'application (par exemple `https://app.packio.fr`, ou `http://localhost:3000` en développement) ;
   - **Jeton personnel** : créé dans Packio, menu **Ventes → Extension Packio Connect** (il n'est affiché qu'une fois) ;
   - le site Vinted utilisé (vinted.fr par défaut) et les plateformes à synchroniser.
5. **Enregistrer et tester la connexion** : Chrome demande l'autorisation de joindre l'adresse de Packio, puis l'extension vérifie le jeton.

Restez connecté à Vinted et/ou Vestiaire Collective dans ce navigateur. La synchronisation a lieu toutes les 15 minutes, ou à la demande depuis la fenêtre de l'extension (**Synchroniser maintenant**).

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
| `manifest.json` | Déclaration (permissions : `storage`, `alarms`, sites Vinted et Vestiaire ; l'accès à Packio est demandé dans les options) |
| `background.js` | Service worker : synchronisation planifiée et à la demande, envoi des bordereaux, journal de la dernière synchronisation |
| `platforms/vinted.js`, `platforms/vestiaire.js` | Toutes les adresses et correspondances de champs propres à chaque plateforme |
| `platforms/common.js` | Requêtes avec la session du navigateur, conversions de prix et de dates |
| `popup.*`, `options.*`, `styles.css` | Interface de l'extension |

API Packio utilisée (authentification `Authorization: Bearer pkx_…`) : `GET /api/extension/status`, `POST /api/extension/sync`, `POST /api/extension/label`.

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

Une publication sur le Chrome Web Store (puis Firefox) est prévue une fois ces points validés.
