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
  // Autorise l'extension à joindre ce serveur Packio (demandé à l'utilisateur).
  const granted = await chrome.permissions.request({ origins: [`${origin}/*`] });
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

el("form").addEventListener("submit", save);
load();
