import * as vinted from "./platforms/vinted.js";
import * as vestiaire from "./platforms/vestiaire.js";
import { NotLoggedInError, arrayBufferToBase64 } from "./platforms/common.js";

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
  cfg.packioUrl = String(cfg.packioUrl || "").replace(/\/+$/, "");
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
    if (!sale.labelRef || uploadedLabels[key]) continue;
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
      const data = await platform.adapter.collect(cfg);
      // La référence du bordereau reste interne à l'extension.
      const sales = data.sales.map((sale) => {
        const copy = { ...sale };
        delete copy.labelRef;
        return copy;
      });
      const res = await packio(cfg, "/api/extension/sync", { platform: platform.key, account: data.account, listings: data.listings, sales });
      const labels = await uploadLabels(cfg, platform, data.sales);
      report.platforms[platform.key] = { status: "ok", listings: res.listings, newSales: res.newSales, shipments: res.shipmentsCreated, labels };
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

chrome.runtime.onInstalled.addListener(() => {
  ensureAlarm();
  chrome.runtime.openOptionsPage();
});
chrome.runtime.onStartup.addListener(ensureAlarm);
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) syncOnce("alarm");
});
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "sync-now") {
    syncOnce("manual").then(sendResponse, (err) => sendResponse({ error: String(err) }));
    return true;
  }
  return false;
});
