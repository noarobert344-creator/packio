// Pont entre la page « Ventes et comptes liés » de Packio et l'extension :
// le client clique sur « Connecter » dans Packio, la page transmet ici son
// jeton personnel et l'extension se configure sans copier-coller.
// Injecté uniquement sur le site Packio de la version publique.
(() => {
  const ORIGIN = location.origin;
  const reply = (payload) => window.postMessage({ source: "packio-connect", ...payload }, ORIGIN);
  const announce = () => reply({ type: "ready", version: chrome.runtime.getManifest().version });

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== ORIGIN) return;
    const data = event.data;
    if (!data || data.source !== "packio-page") return;
    if (data.type === "ping") {
      announce();
      return;
    }
    if (data.type === "connect" && typeof data.token === "string" && /^pkx_[A-Za-z0-9_-]{20,}$/.test(data.token)) {
      chrome.runtime.sendMessage({ type: "connect", token: data.token }, (res) => {
        const error = chrome.runtime.lastError?.message ?? res?.error ?? null;
        reply({ type: "connect-result", ok: !!res?.ok && !error, error, referenceCode: res?.referenceCode ?? null });
      });
    }
  });

  announce();
})();
