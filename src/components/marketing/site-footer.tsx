import Link from "next/link";
import { Mail } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { getSetting } from "@/server/services/settings";

const COLUMNS = [
  {
    title: "Produit",
    links: [
      { href: "/#fonctionnement", label: "Fonctionnement" },
      { href: "/#services", label: "Services" },
      { href: "/synchronisation-ventes", label: "Synchronisation des ventes" },
      { href: "/#preparateurs", label: "Préparateurs" },
      { href: "/#tarifs", label: "Tarifs" },
    ],
  },
  {
    title: "Support",
    links: [
      { href: "/#faq", label: "Questions fréquentes" },
      { href: "/#contact", label: "Nous contacter" },
      { href: "/connexion", label: "Connexion" },
      { href: "/inscription", label: "Créer un compte" },
    ],
  },
  {
    title: "Légal",
    links: [
      { href: "/legal/mentions-legales", label: "Mentions légales" },
      { href: "/legal/cgu", label: "Conditions d'utilisation" },
      { href: "/legal/cgv", label: "Conditions de vente" },
      { href: "/legal/confidentialite", label: "Confidentialité" },
      { href: "/legal/cookies", label: "Cookies" },
    ],
  },
];

export async function SiteFooter() {
  const support = await getSetting("support").catch(() => null);
  return (
    <footer className="border-t bg-muted/30">
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.4fr_repeat(3,1fr)] lg:px-8">
        <div className="space-y-4">
          <Logo />
          <p className="max-w-xs text-sm leading-relaxed text-muted-foreground">
            La logistique déléguée pour les vendeurs e-commerce : un préparateur attitré réceptionne, stocke et expédie vos commandes.
          </p>
          {support?.email && (
            <a href={`mailto:${support.email}`} className="inline-flex items-center gap-2 text-sm text-foreground/80 hover:text-foreground">
              <Mail className="size-4" />
              {support.email}
            </a>
          )}
        </div>
        {COLUMNS.map((col) => (
          <div key={col.title} className="space-y-3">
            <p className="text-sm font-semibold">{col.title}</p>
            <ul className="space-y-2">
              {col.links.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="text-sm text-muted-foreground transition-colors hover:text-foreground">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-4 py-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <p>© {new Date().getFullYear()} Packio. Tous droits réservés.</p>
          <p>Paiements sécurisés par Whop</p>
        </div>
      </div>
    </footer>
  );
}
