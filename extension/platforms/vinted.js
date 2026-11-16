import { NotLoggedInError, currencyOf, getJson, readWithAi, toCents, toIso } from "./common.js";

/**
 * Adaptateur Vinted.
 *
 * Vinted ne publie pas d'API pour les particuliers (l'API « Vinted Pro
 * Integrations » est réservée aux comptes professionnels agréés). Les adresses
 * ci-dessous sont celles qu'utilise l'application web de Vinted pour afficher
 * les pages « Mon dressing » et « Mes commandes » à l'utilisateur connecté.
 * Elles ne sont pas documentées et peuvent changer sans préavis : chaque
 * point marqué « À VÉRIFIER » doit être validé avec un vrai compte, onglet
 * Réseau des outils de développement ouvert sur ces pages.
 */

export const PLATFORM = "VINTED";
const PER_PAGE = 96;
const MAX_PAGES = 5;

/** Utilisateur connecté. À VÉRIFIER : chemin exact (/api/v2/users/current) et forme de la réponse ({ user: { id, login } }). */
async function currentUser(base) {
  const res = await getJson(`${base}/api/v2/users/current`);
  if (res.unauthorized) return null;
  const user = res.data?.user ?? res.data;
  return user && user.id ? { id: String(user.id), login: user.login ?? user.username ?? null } : null;
}

/** Articles du dressing. À VÉRIFIER : /api/v2/wardrobe/{userId}/items, pagination et champs (is_closed, is_reserved, is_hidden, price, photos). */
async function wardrobe(base, userId) {
  const items = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await getJson(`${base}/api/v2/wardrobe/${encodeURIComponent(userId)}/items?page=${page}&per_page=${PER_PAGE}&order=relevance`);
    if (res.unauthorized) break;
    const batch = res.data?.items ?? [];
    items.push(...batch);
    const pagination = res.data?.pagination;
    if (!batch.length || (pagination && page >= (pagination.total_pages ?? page))) break;
  }
  return items.map((item) => ({
    externalId: String(item.id),
    title: String(item.title ?? "Article").slice(0, 300),
    description: item.description ? String(item.description).slice(0, 5000) : undefined,
    url: item.url ? (String(item.url).startsWith("http") ? item.url : `${base}${item.url}`) : `${base}/items/${item.id}`,
    priceCents: toCents(item.price ?? item.price_numeric),
    currency: currencyOf(item.price, String(item.currency ?? "eur").toLowerCase()),
    photoUrl: item.photo?.url ?? item.photos?.[0]?.url ?? undefined,
    status: item.is_closed ? "sold" : item.is_reserved ? "reserved" : item.is_hidden ? "hidden" : "active",
  }));
}

/**
 * Ventes. À VÉRIFIER : /api/v2/my_orders?type=sold&status=all, clé de liste
 * (my_orders), identifiants (transaction_id, item_id) et nom de l'acheteur.
 */
async function soldOrders(base, config) {
  const res = await getJson(`${base}/api/v2/my_orders?type=sold&status=all&page=1&per_page=50`);
  if (res.unauthorized) return [];
  const orders = res.data?.my_orders ?? res.data?.orders;
  if (!Array.isArray(orders)) {
    // Structure inconnue : lecture assistée par l'IA de Packio.
    const sales = await readWithAi(config, res.data, "des ventes Vinted");
    return sales.map((s) => ({ ...s, labelRef: { transactionId: s.externalOrderId, url: s.labelUrl ?? null } }));
  }
  // Les ventes annulées et les colis déjà partis sont transmis : Packio bloque
  // l'expédition d'une vente annulée et marque expédié un colis déjà parti.
  return orders.map((o) => {
    const transactionId = o.transaction_id ?? o.id;
    const items = bundleItems(o);
    return {
      externalOrderId: String(transactionId),
      externalItemId: o.item_id ? String(o.item_id) : o.item?.id ? String(o.item.id) : undefined,
      title: String(o.title ?? o.item?.title ?? items?.[0]?.title ?? "Article vendu").slice(0, 300),
      priceCents: toCents(o.price ?? o.total_item_price),
      currency: currencyOf(o.price),
      buyerName: o.opposite_user?.login ?? o.buyer?.login ?? o.user?.login ?? undefined,
      soldAt: toIso(o.date ?? o.created_at ?? o.updated_at),
      size: sizeOf(o.item ?? o) ?? undefined,
      photoUrl: photoOf(o.item ?? o) ?? undefined,
      shipBy: dateOrUndefined(o.shipment_deadline ?? o.shipping_deadline ?? o.transaction?.shipment_deadline ?? o.shipment?.deadline),
      status: String(o.status ?? o.transaction_user_status ?? o.status_title ?? "").slice(0, 60) || undefined,
      items: items && items.length > 1 ? items : undefined,
      // Interne à l'extension (non transmis à Packio) : sert à récupérer le bordereau.
      labelRef: { transactionId: String(transactionId) },
    };
  });
}

/** À VÉRIFIER : taille de l'article (size_title / size). */
function sizeOf(o) {
  const v = o?.size_title ?? o?.size?.title ?? o?.size;
  return typeof v === "string" && v.trim() ? v.trim().slice(0, 40) : null;
}

/** À VÉRIFIER : photo principale (photo.url, photos[0].url). */
function photoOf(o) {
  const url = o?.photo?.url ?? o?.photos?.[0]?.url ?? o?.photo?.full_size_url;
  return typeof url === "string" && url.startsWith("https://") ? url : null;
}

function dateOrUndefined(v) {
  if (!v) return undefined;
  const d = new Date(typeof v === "number" && v < 1e12 ? v * 1000 : v);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/** À VÉRIFIER : ventes en lot (plusieurs articles pour un même acheteur). */
function bundleItems(o) {
  const list = o.items ?? o.order?.items ?? o.transaction?.items;
  if (!Array.isArray(list) || list.length < 2) return null;
  return list.slice(0, 30).map((it) => ({
    externalItemId: it.id ?? it.item_id ? String(it.id ?? it.item_id) : undefined,
    title: String(it.title ?? "Article").slice(0, 300),
    size: sizeOf(it) ?? undefined,
    photoUrl: photoOf(it) ?? undefined,
    priceCents: toCents(it.price),
  }));
}

/** Collecte complète pour la synchronisation. */
export async function collect(config) {
  const base = `https://${config.vintedDomain || "www.vinted.fr"}`;
  const user = await currentUser(base);
  if (!user) throw new NotLoggedInError("Vinted");
  const [listings, sales] = await Promise.all([wardrobe(base, user.id), soldOrders(base, config)]);
  return { account: { externalUserId: user.id, username: user.login ?? undefined }, listings, sales };
}

/**
 * Bordereau d'une vente, une fois généré par le vendeur sur Vinted.
 * À VÉRIFIER : /api/v2/transactions/{id} → transaction.shipment.id, puis
 * /api/v2/shipments/{shipmentId}/label_url → { label_url } (PDF). Renvoie null
 * tant qu'aucun bordereau n'est disponible.
 */
export async function fetchLabel(labelRef, config) {
  const base = `https://${config.vintedDomain || "www.vinted.fr"}`;
  // URL du bordereau déjà connue (lecture assistée par l'IA).
  if (labelRef.url) {
    const direct = await fetch(labelRef.url, { credentials: "include" });
    const kind = direct.headers.get("content-type") || "";
    if (direct.ok && /pdf|image\//i.test(kind)) {
      return { buffer: await direct.arrayBuffer(), filename: `bordereau-vinted-${labelRef.transactionId}.${/pdf/i.test(kind) ? "pdf" : "png"}` };
    }
  }
  const tx = await getJson(`${base}/api/v2/transactions/${encodeURIComponent(labelRef.transactionId)}`);
  if (tx.unauthorized) return null;
  const shipmentId = tx.data?.transaction?.shipment?.id ?? tx.data?.shipment?.id;
  if (!shipmentId) return null;
  const urlRes = await getJson(`${base}/api/v2/shipments/${encodeURIComponent(shipmentId)}/label_url`);
  const labelUrl = urlRes.data?.label_url ?? urlRes.data?.url;
  if (!labelUrl) return null;
  const file = await fetch(labelUrl, { credentials: "include" });
  if (!file.ok) return null;
  const type = file.headers.get("content-type") || "";
  if (!/pdf|image\//i.test(type)) return null;
  return { buffer: await file.arrayBuffer(), filename: `bordereau-vinted-${labelRef.transactionId}.${/pdf/i.test(type) ? "pdf" : "png"}` };
}
