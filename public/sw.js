/* Packio : page « mise à jour en cours » et notifications sur le téléphone (Web Push). */
const CACHE = "packio-maintenance-v1";
const MAINTENANCE = "/maintenance.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.add(new Request(MAINTENANCE, { cache: "reload" })))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("packio-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/**
 * Pendant une mise à jour, le serveur est coupé quelques instants (erreur 502,
 * 503 ou 504, ou aucune réponse) : au lieu de la page d'erreur de
 * l'hébergeur, on affiche la page « Packio se met à jour », qui se recharge
 * toute seule. Seules les pages (navigation) sont concernées ; tout le reste
 * passe directement par le réseau, sans cache.
 */
async function maintenancePage() {
  const cached = await caches.match(MAINTENANCE);
  if (cached) {
    return new Response(cached.body, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Retry-After": "30" } });
  }
  return Response.error();
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.mode !== "navigate" || request.method !== "GET") return;
  event.respondWith(
    fetch(request)
      .then((response) => ([502, 503, 504].includes(response.status) ? maintenancePage() : response))
      .catch(() => maintenancePage()),
  );
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "Packio", {
      body: data.body || "",
      icon: "/icons/icon-192.png",
      tag: data.tag || undefined,
      data: { link: data.link || "/connexion" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  // Uniquement des pages de Packio.
  let target = new URL("/connexion", self.location.origin);
  try {
    const link = new URL(event.notification.data && event.notification.data.link ? event.notification.data.link : "/connexion", self.location.origin);
    if (link.origin === self.location.origin) target = link;
  } catch {
    // lien invalide : page d'accueil de l'espace
  }
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        if (new URL(client.url).origin === self.location.origin && "focus" in client) {
          await client.focus();
          if ("navigate" in client) await client.navigate(target.href).catch(() => self.clients.openWindow(target.href));
          return;
        }
      }
      await self.clients.openWindow(target.href);
    })(),
  );
});
