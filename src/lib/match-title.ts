/**
 * Rapprochement d'une vente (titre de l'annonce, taille) avec un article du
 * stock, sans code à recopier. Deux niveaux :
 * - « sûr » : même nom, accents et ponctuation mis à part (éventuellement avec
 *   la taille), et un seul article correspondant → prise automatique sur le stock ;
 * - « suggestion » : le nom de l'article est contenu dans le titre (ou
 *   l'inverse) → pré-sélectionné dans « Vente normale », le client confirme.
 */

export function normalizeTitle(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

type Candidate = { id: string; name: string };

function variants(title: string, size?: string | null) {
  const base = normalizeTitle(title);
  const out = new Set([base]);
  if (size?.trim()) {
    const s = normalizeTitle(size);
    out.add(`${base} ${s}`);
    out.add(`${base} taille ${s}`);
  }
  return out;
}

/** Article dont le nom correspond exactement, s'il est le seul ; sinon null. */
export function exactStockMatch<T extends Candidate>(title: string, size: string | null | undefined, items: T[]): T | null {
  const wanted = variants(title, size);
  const hits = items.filter((i) => wanted.has(normalizeTitle(i.name)));
  return hits.length === 1 ? hits[0] : null;
}

/** Meilleure suggestion (correspondance exacte, sinon nom contenu dans le titre). */
export function suggestStockItem<T extends Candidate>(title: string, size: string | null | undefined, items: T[]): T | null {
  const exact = exactStockMatch(title, size, items);
  if (exact) return exact;
  const t = normalizeTitle(title);
  if (t.length < 4) return null;
  const scored = items
    .map((i) => ({ i, n: normalizeTitle(i.name) }))
    .filter(({ n }) => n.length >= 4 && (t.includes(n) || n.includes(t)))
    .sort((a, b) => b.n.length - a.n.length);
  if (!scored.length) return null;
  // Deux articles au nom identique : pas de suggestion, le client choisit.
  if (scored.length > 1 && scored[0].n === scored[1].n) return null;
  return scored[0].i;
}

/** Date limite estimée : N jours ouvrés après la vente (samedi et dimanche exclus). */
export function addBusinessDays(from: Date, days: number) {
  const d = new Date(from);
  let left = days;
  while (left > 0) {
    d.setDate(d.getDate() + 1);
    const day = d.getDay();
    if (day !== 0 && day !== 6) left--;
  }
  return d;
}

export type PlatformSaleState = "active" | "cancelled" | "shipped";

/** État transmis par l'extension (texte libre de la plateforme) ramené à trois cas. */
export function saleStateFrom(status: string | null | undefined): PlatformSaleState {
  const s = (status ?? "").toLowerCase();
  if (!s) return "active";
  if (/cancel|annul|refund|rembours|declin|refus/.test(s)) return "cancelled";
  if (/shipped|sent|envoy|exp[ée]di|deliver|livr|complet|termin|done|received|re[çc]u/.test(s)) return "shipped";
  return "active";
}
