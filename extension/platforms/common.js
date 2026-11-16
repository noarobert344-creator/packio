/**
 * Outils communs aux adaptateurs de plateformes.
 * Toutes les requêtes partent du navigateur de l'utilisateur, avec sa propre
 * session (cookies) : aucun identifiant n'est stocké par l'extension.
 */

export class NotLoggedInError extends Error {
  constructor(platform) {
    super(`${platform} : aucune session ouverte dans ce navigateur.`);
    this.name = "NotLoggedInError";
  }
}

/**
 * `anonymousStatuses` : codes à traiter comme « pas de session » (certaines
 * API répondent 404 au lieu de 401 quand personne n'est connecté).
 */
/** Taille maximale d'un extrait envoyé à l'assistance IA de Packio. */
const AI_MAX_CHARS = 150000;

/**
 * Réponse illisible (structure modifiée par la plateforme) : l'extrait est
 * confié à l'assistance IA de Packio, qui renvoie les ventes au bon format.
 * Sans assistance disponible, l'erreur d'origine est remontée.
 */
export async function readWithAi(config, data, what) {
  if (typeof config?.ai !== "function") throw new Error(`Réponse ${what} illisible : la plateforme a peut-être changé.`);
  const raw = typeof data === "string" ? data : JSON.stringify(data);
  return config.ai(raw.slice(0, AI_MAX_CHARS));
}

export async function getJson(url, init = {}, anonymousStatuses = []) {
  const res = await fetch(url, {
    credentials: "include",
    headers: { Accept: "application/json, text/plain, */*", ...(init.headers || {}) },
    ...init,
  });
  if (res.status === 401 || res.status === 403 || anonymousStatuses.includes(res.status)) return { unauthorized: true, status: res.status };
  if (!res.ok) throw new Error(`HTTP ${res.status} sur ${new URL(url).pathname}`);
  return { data: await res.json(), status: res.status };
}

/** Montant en centimes à partir d'un nombre, d'une chaîne « 12.50 » ou d'un objet { amount }. */
export function toCents(value) {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "object") return toCents(value.amount ?? value.value);
  const n = Number(String(value).replace(",", ".").replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : undefined;
}

export function currencyOf(value, fallback = "eur") {
  if (value && typeof value === "object") return String(value.currency_code ?? value.currency ?? fallback).toLowerCase();
  return fallback;
}

/** Date ISO à partir d'une date ISO, d'un horodatage en secondes ou en millisecondes. */
export function toIso(value) {
  if (!value) return new Date().toISOString();
  if (typeof value === "number") return new Date(value < 1e12 ? value * 1000 : value).toISOString();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

export function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  return btoa(binary);
}
