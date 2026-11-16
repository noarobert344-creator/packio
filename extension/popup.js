import { PACKIO_URL } from "./config.js";
const LABELS = { VINTED: "Vinted", VESTIAIRE: "Vestiaire Collective" };
const STATUS = {
  ok: ["ok", "Synchronisé"],
  logged_out: ["warn", "Non connecté"],
  disabled: ["", "Désactivé"],
  error: ["danger", "Erreur"],
};

function render(report) {
  const box = document.getElementById("platforms");
  box.replaceChildren();
  for (const key of Object.keys(LABELS)) {
    const info = report?.platforms?.[key];
    const row = document.createElement("div");
    row.className = "row";
    const name = document.createElement("span");
    name.textContent = LABELS[key];
    const badge = document.createElement("span");
    const [tone, text] = info ? STATUS[info.status] ?? ["", info.status] : ["", "En attente"];
    badge.className = `badge ${tone}`;
    badge.textContent = text;
    row.append(name, badge);
    box.append(row);
    if (info?.status === "ok") {
      const detail = document.createElement("p");
      detail.className = "muted";
      detail.textContent = `${info.listings} annonce(s), ${info.newSales} nouvelle(s) vente(s), ${info.shipments} expédition(s), ${info.labels} bordereau(x)${info.assisted ? " · lecture assistée par IA" : ""}`;
      box.append(detail);
    } else if (info?.message) {
      const detail = document.createElement("p");
      detail.className = "muted";
      detail.textContent = info.message;
      box.append(detail);
    }
  }
  const last = document.getElementById("last-sync");
  if (report?.error) last.textContent = report.error;
  else if (report?.at) last.textContent = `Dernière synchronisation : ${new Date(report.at).toLocaleString("fr-FR")}`;
}

async function init() {
  const cfg = await chrome.storage.sync.get({ packioUrl: PACKIO_URL, token: "" });
  document.getElementById("config-warning").hidden = !!(cfg.packioUrl && cfg.token);
  cfg.packioUrl = PACKIO_URL || cfg.packioUrl;
  const open = document.getElementById("open-packio");
  if (cfg.packioUrl) open.href = `${cfg.packioUrl.replace(/\/+$/, "")}/client/ventes`;
  else open.hidden = true;
  document.getElementById("open-options").addEventListener("click", (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
  const { lastSync } = await chrome.storage.local.get("lastSync");
  render(lastSync);
  const button = document.getElementById("sync");
  button.addEventListener("click", async () => {
    button.disabled = true;
    button.textContent = "Synchronisation…";
    try {
      render(await chrome.runtime.sendMessage({ type: "sync-now" }));
    } finally {
      button.disabled = false;
      button.textContent = "Synchroniser maintenant";
    }
  });
}

init();
