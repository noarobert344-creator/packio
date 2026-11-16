import * as vinted from "./platforms/vinted.js";
import * as vestiaire from "./platforms/vestiaire.js";
import { NotLoggedInError, arrayBufferToBase64 } from "./platforms/common.js";
import { PACKIO_URL } from "./config.js";
import { getConsent } from "./consent.js";

/**
 * Packio Connect : synchronisation périodique (toutes les 15 minutes) ou à la
 * demande des annonces, ventes et bordereaux vers Packio.
 */

const ALARM = "packio-sync";
const PLATFORMS = [
  { key: "VINTED", label: "Vinted", adapter: vinted, setting: "enableVinted" },
  { key: "VESTIAIRE", label: "Vestiaire Collective", adapter: vestiaire, setting: "enableVestiaire" },
];
const MAX_LABELS_PER_SYNC = 10;
let running = null;

async function getConfig() {
  const cfg = await chrome.storage.sync.get({ packioUrl: "", token: "", vintedDomain: "www.vinted.fr", enableVinted: true, enableVestiaire: true });
  // Version publique : l'adresse de Packio est intégrée et ne se modifie pas.
  cfg.packioUrl = String(PACKIO_URL || cfg.packioUrl || "").replace(/\/+$/, "");
  return cfg;
}

async function packio(cfg, path, body) {
  const res = await fetch(`${cfg.packioUrl}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Packio : HTTP ${res.status}`);
  return json;
}

async function uploadLabels(cfg, platform, sales) {
  const { uploadedLabels = {} } = await chrome.storage.local.get("uploadedLabels");
  let uploaded = 0;
  for (const sale of sales) {
    if (uploaded >= MAX_LABELS_PER_SYNC) break;
    const key = `${platform.key}:${sale.externalOrderId}`;
    // Vente annulée ou colis déjà parti : pas de bordereau à transmettre.
    if (!sale.labelRef || uploadedLabels[key] || /cancel|annul|refund|rembours|shipped|sent|envoy|deliver|livr|complet|termin/i.test(sale.status || "")) continue;
    try {
      const label = await platform.adapter.fetchLabel(sale.labelRef, cfg);
      if (!label) continue;
      await packio(cfg, "/api/extension/label", {
        platform: platform.key,
        externalOrderId: sale.externalOrderId,
        filename: label.filename,
        contentBase64: arrayBufferToBase64(label.buffer),
      });
      uploadedLabels[key] = Date.now();
      uploaded++;
    } catch (err) {
      console.warn("[Packio Connect] bordereau non transmis", key, err);
    }
  }
  // Cache limité aux 500 bordereaux les plus récents.
  const entries = Object.entries(uploadedLabels).sort((a, b) => b[1] - a[1]).slice(0, 500);
  await chrome.storage.local.set({ uploadedLabels: Object.fromEntries(entries) });
  return uploaded;
}

async function syncAll(trigger) {
  const cfg = await getConfig();
  const report = { at: new Date().toISOString(), trigger, platforms: {} };
  // Rien n'est lu ni envoyé sans l'accord de l'utilisateur.
  if (!(await getConsent())) {
    report.error = "En attente de votre accord : ouvrez Packio Connect et acceptez la lecture de vos ventes.";
    await chrome.storage.local.set({ lastSync: report });
    return report;
  }
  if (!cfg.packioUrl || !cfg.token) {
    report.error = "Configurez l'adresse de Packio et votre jeton dans les options.";
    await chrome.storage.local.set({ lastSync: report });
    return report;
  }
  for (const platform of PLATFORMS) {
    if (!cfg[platform.setting]) {
      report.platforms[platform.key] = { status: "disabled" };
      continue;
    }
    try {
      let assisted = false;
      // Secours : extrait illisible confié à l'assistance IA de Packio (côté serveur).
      const ai = async (raw) => {
        assisted = true;
        const res = await packio(cfg, "/api/extension/ai-extract", { platform: platform.key, content: raw });
        return res.sales || [];
      };
      const data = await platform.adapter.collect({ ...cfg, ai });
      // La référence et l'URL du bordereau restent internes à l'extension.
      const sales = data.sales.map((sale) => {
        const copy = { ...sale };
        delete copy.labelRef;
        delete copy.labelUrl;
        return copy;
      });
      const res = await packio(cfg, "/api/extension/sync", { platform: platform.key, account: data.account, listings: data.listings, sales });
      const labels = await uploadLabels(cfg, platform, data.sales);
      report.platforms[platform.key] = {
        status: "ok",
        listings: res.listings,
        newSales: res.newSales,
        shipments: res.shipmentsCreated,
        cancelled: res.cancelled ?? 0,
        shipped: res.shipped ?? 0,
        labels,
        assisted,
      };
    } catch (err) {
      report.platforms[platform.key] = err instanceof NotLoggedInError ? { status: "logged_out", message: err.message } : { status: "error", message: String(err && err.message ? err.message : err) };
    }
  }
  await chrome.storage.local.set({ lastSync: report });
  return report;
}

function syncOnce(trigger) {
  if (!running) running = syncAll(trigger).finally(() => (running = null));
  return running;
}

async function ensureAlarm() {
  if (!(await chrome.alarms.get(ALARM))) chrome.alarms.create(ALARM, { periodInMinutes: 15, delayInMinutes: 1 });
}

chrome.runtime.onInstalled.addListener(async (details) => {
  ensureAlarm();
  // Première installation, ou mise à jour sans accord : page d'accord et de réglages.
  if (details.reason === "install" || !(await getConsent())) chrome.runtime.openOptionsPage();
});
chrome.runtime.onStartup.addListener(ensureAlarm);
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) syncOnce("alarm");
});
/**
 * Connexion en un clic depuis la page Packio (script connect.js) : le jeton
 * n'est accepté que s'il vient du site Packio intégré à l'extension.
 */
async function connectFromPage(token, sender) {
  if (!PACKIO_URL) throw new Error("Connexion automatique indisponible : configurez l'extension dans ses options.");
  const expected = new URL(PACKIO_URL).origin;
  const from = sender?.origin || (sender?.url ? new URL(sender.url).origin : "");
  if (from !== expected) throw new Error("Origine non autorisée.");
  const res = await fetch(`${expected}/api/extension/status`, { headers: { Authorization: `Bearer ${token}` } });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Packio : HTTP ${res.status}`);
  const previous = await chrome.storage.sync.get(["packioUrl", "token"]);
  await chrome.storage.sync.set({ packioUrl: expected, token });
  // Reconnexion : l'ancien jeton de ce navigateur est révoqué, pour ne pas
  // accumuler des accès inutilisés dans le compte.
  if (previous.token && previous.token !== token && (!previous.packioUrl || new URL(previous.packioUrl).origin === expected)) {
    fetch(`${expected}/api/extension/status`, { method: "DELETE", headers: { Authorization: `Bearer ${previous.token}` } }).catch(() => undefined);
  }
  if (!(await getConsent())) {
    // Connexion faite, mais aucune lecture avant l'accord : on l'affiche.
    chrome.runtime.openOptionsPage();
    return { ok: true, needsConsent: true, referenceCode: json.customer?.referenceCode ?? null };
  }
  syncOnce("connect").catch(() => undefined);
  return { ok: true, referenceCode: json.customer?.referenceCode ?? null };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "sync-now") {
    syncOnce("manual").then(sendResponse, (err) => sendResponse({ error: String(err) }));
    return true;
  }
  if (message?.type === "connect" && typeof message.token === "string") {
    connectFromPage(message.token, sender).then(sendResponse, (err) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }));
    return true;
  }
  return false;
});
