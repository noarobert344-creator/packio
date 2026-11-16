import type { MetadataRoute } from "next";

const LEGAL = ["mentions-legales", "cgu", "cgv", "confidentialite", "cookies"];

export default function sitemap(): MetadataRoute.Sitemap {
  const base = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const now = new Date();
  return [
    { url: `${base}/`, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/synchronisation-ventes`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${base}/inscription`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${base}/connexion`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    ...LEGAL.map((slug) => ({ url: `${base}/legal/${slug}`, lastModified: now, changeFrequency: "yearly" as const, priority: 0.2 })),
  ];
}
