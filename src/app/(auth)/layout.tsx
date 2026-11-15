import Link from "next/link";
import { Boxes, MessagesSquare, ShieldCheck, Truck } from "lucide-react";
import { Logo } from "@/components/brand/logo";

const POINTS = [
  { icon: Truck, title: "Un préparateur attitré", text: "Vos colis arrivent chez une personne identifiée, qui réceptionne, contrôle et expédie." },
  { icon: Boxes, title: "Votre stock en temps réel", text: "Chaque article reçu est photographié, référencé et suivi jusqu'à son expédition." },
  { icon: MessagesSquare, title: "Une messagerie directe", text: "Échangez avec votre préparateur à propos d'une commande ou d'une expédition." },
  { icon: ShieldCheck, title: "Paiements sécurisés", text: "Abonnement et recharges gérés par Stripe. Vos crédits sont tracés au détail près." },
];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_minmax(0,34rem)] xl:grid-cols-[1fr_minmax(0,38rem)]">
      <div className="flex flex-col px-5 py-6 sm:px-10">
        <Link href="/" className="w-fit" aria-label="Accueil Packio">
          <Logo />
        </Link>
        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-[25rem] animate-in fade-in slide-in-from-bottom-2 duration-500">{children}</div>
        </div>
        <p className="text-center text-xs text-muted-foreground">
          <Link href="/legal/confidentialite" className="hover:text-foreground">
            Confidentialité
          </Link>
          <span className="mx-2">·</span>
          <Link href="/legal/cgu" className="hover:text-foreground">
            Conditions d&apos;utilisation
          </Link>
          <span className="mx-2">·</span>
          <Link href="/#contact" className="hover:text-foreground">
            Support
          </Link>
        </p>
      </div>
      <aside className="relative hidden overflow-hidden bg-[oklch(0.17_0.02_266)] text-white lg:block">
        <div className="absolute inset-0 bg-grid opacity-[0.25] mask-radial" />
        <div className="absolute -top-32 -right-24 size-[28rem] rounded-full bg-[oklch(0.53_0.255_266)] opacity-40 blur-3xl" />
        <div className="relative flex h-full flex-col justify-between p-12">
          <p className="text-sm font-medium tracking-[0.2em] text-white/60">LOGISTIQUE DÉLÉGUÉE</p>
          <div className="space-y-8">
            <h2 className="max-w-md text-3xl leading-tight font-semibold text-balance">Vendez. Votre préparateur s&apos;occupe des colis.</h2>
            <ul className="space-y-5">
              {POINTS.map((p) => (
                <li key={p.title} className="flex gap-4">
                  <span className="mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/15">
                    <p.icon className="size-4" />
                  </span>
                  <div>
                    <p className="font-medium">{p.title}</p>
                    <p className="text-sm text-white/65">{p.text}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <p className="text-xs text-white/45">© {new Date().getFullYear()} Packio</p>
        </div>
      </aside>
    </div>
  );
}
