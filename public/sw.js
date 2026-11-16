/* Packio : notifications sur le téléphone (Web Push). */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

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
