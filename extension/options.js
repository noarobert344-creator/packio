import { PACKIO_URL } from "./config.js";
import { getConsent, giveConsent, renderDisclosure, withdrawConsent } from "./consent.js";

const FIELDS = ["packioUrl", "token", "vintedDomain", "enableVinted", "enableVestiaire"];
const DEFAULTS = { packioUrl: "", token: "", vintedDomain: "www.vinted.fr", enableVinted: true, enableVestiaire: true };

function el(id) {
  return document.getElementById(id);
}

async function load() {
  const cfg = await chrome.storage.sync.get(DEFAULTS);
  for (const f of FIELDS) {
    const input = el(f);
    if (input.type === "checkbox") input.checked = !!cfg[f];
    else input.value = cfg[f];
  }
  el("disconnect").hidden = !cfg.token;
  // Version publique : adresse intégrée, non modifiable.
  if (PACKIO_URL) {
    el("packioUrl").value = PACKIO_URL;
    el("packioUrl").readOnly = true;
  }
}

async function save(event) {
  event.preventDefault();
  const result = el("result");
  result.textContent = "Vérification…";
  let origin;
  try {
    origin = new URL(el("packioUrl").value.trim()).origin;
  } catch {
    result.textContent = "Adresse de Packio invalide.";
    return;
  }
  // Autorise l'extension à joindre ce serveur Packio (demandé à l'utilisateur),
  // sauf en version publique où l'accès au site Packio est déjà déclaré.
  const granted = PACKIO_URL ? true : await chrome.permissions.request({ origins: [`${origin}/*`] });
  if (!granted) {
    result.textContent = "Autorisation refusée : l'extension ne peut pas joindre Packio.";
    return;
  }
  const cfg = {
    packioUrl: origin,
    token: el("token").value.trim(),
    vintedDomain: el("vintedDomain").value,
    enableVinted: el("enableVinted").checked,
    enableVestiaire: el("enableVestiaire").checked,
  };
  await chrome.storage.sync.set(cfg);
  try {
    const res = await fetch(`${origin}/api/extension/status`, { headers: { Authorization: `Bearer ${cfg.token}` } });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
    const accounts = (json.accounts || []).map((a) => a.platform).join(", ") || "aucun pour l'instant";
    result.textContent = `Connecté au compte ${json.customer.referenceCode} (${json.customer.firstName}). Comptes déjà liés : ${accounts}.`;
    chrome.runtime.sendMessage({ type: "sync-now" });
  } catch (err) {
    result.textContent = `Connexion impossible : ${err.message}`;
  }
}

/** Révoque le jeton de ce navigateur dans Packio, puis l'oublie localement. */
async function disconnect() {
  const result = el("result");
  const { packioUrl, token } = await chrome.storage.sync.get(["packioUrl", "token"]);
  const base = PACKIO_URL || packioUrl;
  if (token && base) {
    await fetch(`${new URL(base).origin}/api/extension/status`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }).catch(() => undefined);
  }
  await chrome.storage.sync.set({ token: "" });
  await chrome.storage.local.remove("lastSync");
  el("token").value = "";
  el("disconnect").hidden = true;
  result.textContent = "Extension déconnectée : plus aucune donnée n'est envoyée à Packio depuis ce navigateur.";
}

/** Accord explicite avant toute lecture ; révocable ici à tout moment. */
async function renderConsent() {
  const consent = await getConsent();
  el("consent-box").hidden = !!consent;
  el("consent-given").hidden = !consent;
  if (consent) {
    el("consent-date").textContent = `Accord donné le ${new Date(consent.at).toLocaleString("fr-FR")} : la lecture de vos ventes est active.`;
  } else {
    renderDisclosure(el("consent-text"));
  }
}

el("consent-accept").addEventListener("click", async () => {
  await giveConsent();
  await renderConsent();
  const { token } = await chrome.storage.sync.get({ token: "" });
  if (token) chrome.runtime.sendMessage({ type: "sync-now" });
});
el("consent-withdraw").addEventListener("click", async () => {
  await withdrawConsent();
  await renderConsent();
  el("result").textContent = "Accord retiré : plus rien n'est lu ni envoyé à Packio depuis ce navigateur.";
});
el("form").addEventListener("submit", save);
renderConsent();
el("disconnect").addEventListener("click", disconnect);
load();
