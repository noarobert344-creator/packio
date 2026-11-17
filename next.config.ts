import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cache Components is intentionally disabled: Packio is an authenticated,
  // per-user application where nearly every route reads the session.
  poweredByHeader: false,
  // Version du site (commit déployé), comparée par le navigateur pour annoncer
  // les mises à jour (voir src/components/shared/update-watcher.tsx).
  // Valeur fixe en développement : une valeur changeante relancerait la compilation en boucle.
  env: {
    APP_VERSION: (
      process.env.RENDER_GIT_COMMIT ||
      process.env.VERCEL_GIT_COMMIT_SHA ||
      (process.env.NODE_ENV === "production" ? `local-${Date.now().toString(36)}` : "dev")
    ).slice(0, 12),
  },
  serverExternalPackages: ["@prisma/client", "pg", "discord.js"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "12mb",
    },
  },
  images: {
    remotePatterns: [],
  },
  // Notifications sur le téléphone : le service worker est toujours relu à jour.
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
