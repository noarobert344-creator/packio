import type { MetadataRoute } from "next";

/** Application installable (écran d'accueil du téléphone) : nécessaire aux notifications sur iPhone. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Packio",
    short_name: "Packio",
    description: "Votre logistique e-commerce, déléguée à un préparateur attitré.",
    lang: "fr",
    start_url: "/connexion",
    scope: "/",
    display: "standalone",
    background_color: "#0b0d12",
    theme_color: "#121318",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
