import { PACKIO_URL } from "./config.js";

/**
 * Accord de l'utilisateur (règles du Chrome Web Store) : rien n'est lu sur
 * Vinted ou Vestiaire Collective ni envoyé à Packio avant un accord explicite,
 * donné au premier lancement et révocable à tout moment dans les options.
 */
export const CONSENT_VERSION = 1;

const ITEMS = [
  "vos annonces : titre, description, prix et photo principale ;",
  "vos ventes : article vendu, prix, date, pseudonyme de l'acheteur et suivi de l'expédition ;",
  "les bordereaux d'expédition (PDF), qui contiennent le nom et l'adresse de l'acheteur.",
];

const POINTS = [
  "Ces données sont envoyées uniquement à votre compte Packio, automatiquement toutes les 15 minutes et quand vous cliquez sur « Synchroniser maintenant ».",
  "Si une page de ventes ne peut pas être lue, l'extrait est transmis à Packio pour une lecture de secours ; les données personnelles sont masquées avant tout recours à un service d'intelligence artificielle.",
  "Vos mots de passe ne sont jamais lus. Rien n'est publié ni modifié sur Vinted ou Vestiaire Collective. Les données ne sont ni vendues, ni utilisées pour de la publicité.",
  "Vous pouvez retirer votre accord à tout moment dans les options de l'extension.",
];

export async function getConsent() {
  const { consent } = await chrome.storage.local.get("consent");
  return consent && consent.version === CONSENT_VERSION ? consent : null;
}

export async function giveConsent() {
  const consent = { version: CONSENT_VERSION, at: new Date().toISOString() };
  await chrome.storage.local.set({ consent });
  return consent;
}

export async function withdrawConsent() {
  await chrome.storage.local.remove(["consent", "lastSync"]);
}

/** Texte d'information affiché avant l'accord (popup et options). */
export function renderDisclosure(container) {
  const title = document.createElement("h2");
  title.textContent = "Avant de commencer : votre accord";
  const intro = document.createElement("p");
  intro.textContent =
    "Pour que votre préparateur expédie vos ventes, Packio Connect lit, avec la session Vinted et Vestiaire Collective déjà ouverte dans ce navigateur :";
  const list = document.createElement("ul");
  for (const item of ITEMS) {
    const li = document.createElement("li");
    li.textContent = item;
    list.append(li);
  }
  const points = document.createElement("ul");
  points.className = "muted";
  for (const point of POINTS) {
    const li = document.createElement("li");
    li.textContent = point;
    points.append(li);
  }
  container.replaceChildren(title, intro, list, points);
  if (PACKIO_URL) {
    const link = document.createElement("a");
    link.href = `${PACKIO_URL.replace(/\/+$/, "")}/legal/confidentialite`;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = "Politique de confidentialité de Packio";
    container.append(link);
  }
}
