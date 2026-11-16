import { NotLoggedInError, currencyOf, getJson, readWithAi, toCents, toIso } from "./common.js";

/**
 * Adaptateur Vestiaire Collective.
 *
 * Vestiaire Collective ne publie pas d'API pour les vendeurs particuliers.
 * Les adresses ci-dessous correspondent à l'API utilisée par son site web
 * (apiv2.vestiairecollective.com) ; elles sont TOUTES « À VÉRIFIER » avec un
 * vrai compte (onglet Réseau des outils de développement sur « Mes ventes »).
 * L'API peut exiger un jeton d'accès lu dans le stockage du site plutôt que
 * les seuls cookies : dans ce cas, la lecture devra passer par un script de
 * contenu exécuté sur vestiairecollective.com.
 */

export const PLATFORM = "VESTIAIRE";
const API = "https://apiv2.vestiairecollective.com";

/**
 * À VÉRIFIER : /users/me et forme { data: { id, firstname } }.
 * Sans session, l'API répond 404 (constaté) : traité comme « non connecté ».
 */
async function currentUser() {
  const res = await getJson(`${API}/users/me`, {}, [404]);
  if (res.unauthorized) return null;
  const user = res.data?.data ?? res.data;
  return user && user.id ? { id: String(user.id), name: user.firstname ?? user.username ?? null } : null;
}

/** À VÉRIFIER : produits en vente du membre (/users/{id}/products). */
async function products(userId) {
  const res = await getJson(`${API}/users/${encodeURIComponent(userId)}/products?limit=100&offset=0`);
  if (res.unauthorized) return [];
  const list = res.data?.data ?? res.data?.items ?? [];
  return list.map((p) => ({
    externalId: String(p.id),
    title: String(p.name ?? p.title ?? "Article").slice(0, 300),
    description: p.description ? String(p.description).slice(0, 5000) : undefined,
    url: p.link ? (String(p.link).startsWith("http") ? p.link : `https://www.vestiairecollective.com${p.link}`) : undefined,
    priceCents: toCents(p.price?.cents !== undefined ? p.price.cents / 100 : p.price),
    currency: currencyOf(p.price),
    photoUrl: p.pictures?.[0]?.url ?? undefined,
    status: p.sold ? "sold" : "active",
  }));
}

/** À VÉRIFIER : ventes du membre (/orders/sales ou équivalent). */
async function sales(config) {
  const res = await getJson(`${API}/orders/sales?limit=50&offset=0`);
  if (res.unauthorized) return [];
  const list = res.data?.data ?? res.data?.items;
  if (!Array.isArray(list)) {
    // Structure inconnue : lecture assistée par l'IA de Packio.
    const found = await readWithAi(config, res.data, "des ventes Vestiaire Collective");
    return found.map((s) => ({ ...s, labelRef: s.labelUrl ? { url: s.labelUrl, orderId: s.externalOrderId } : null }));
  }
  return list.map((o) => ({
    externalOrderId: String(o.id ?? o.orderId),
    externalItemId: o.product?.id ? String(o.product.id) : undefined,
    title: String(o.product?.name ?? o.title ?? "Article vendu").slice(0, 300),
    priceCents: toCents(o.price?.cents !== undefined ? o.price.cents / 100 : o.price),
    currency: currencyOf(o.price),
    buyerName: o.buyer?.firstname ?? undefined,
    soldAt: toIso(o.createdAt ?? o.date),
    labelRef: o.shippingLabelUrl ? { url: o.shippingLabelUrl, orderId: String(o.id ?? o.orderId) } : null,
  }));
}

export async function collect(config) {
  const user = await currentUser();
  if (!user) throw new NotLoggedInError("Vestiaire Collective");
  const [listings, soldList] = await Promise.all([products(user.id), sales(config)]);
  return { account: { externalUserId: user.id, username: user.name ?? undefined }, listings, sales: soldList };
}

/** À VÉRIFIER : URL du bordereau fournie avec la vente (shippingLabelUrl). */
export async function fetchLabel(labelRef) {
  if (!labelRef?.url) return null;
  const file = await fetch(labelRef.url, { credentials: "include" });
  if (!file.ok) return null;
  const type = file.headers.get("content-type") || "";
  if (!/pdf|image\//i.test(type)) return null;
  return { buffer: await file.arrayBuffer(), filename: `bordereau-vestiaire-${labelRef.orderId}.${/pdf/i.test(type) ? "pdf" : "png"}` };
}
