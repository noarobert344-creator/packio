import Link from "next/link";
import { ArrowRight, CalendarClock, CreditCard, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Container } from "./section";
import { ProductMock } from "./product-mock";

export function Hero() {
  return (
    <section className="relative overflow-hidden pt-16 pb-20 sm:pt-24 sm:pb-28">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-grid mask-radial opacity-70" aria-hidden />
      <div className="pointer-events-none absolute top-[-12rem] left-1/2 -z-10 size-[44rem] -translate-x-1/2 rounded-full bg-brand/15 blur-3xl" aria-hidden />
      <Container>
        <div className="mx-auto max-w-3xl text-center animate-in fade-in slide-in-from-bottom-3 duration-700">
          <p className="mx-auto mb-6 inline-flex items-center gap-2 rounded-full border bg-background/80 px-3 py-1 text-xs font-medium text-muted-foreground shadow-soft backdrop-blur">
            <span className="size-1.5 rounded-full bg-brand" />
            Logistique e-commerce déléguée
          </p>
          <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-6xl sm:leading-[1.05]">
            Déléguez vos colis à un <span className="text-brand">préparateur attitré</span>.
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-muted-foreground text-balance sm:text-lg">
            Pour les vendeurs e-commerce, revendeurs Vinted et entrepreneurs : vos achats arrivent chez votre préparateur, qui les contrôle, les stocke et les expédie
            à vos acheteurs. Vous suivez chaque colis depuis votre tableau de bord.
          </p>
          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button asChild size="lg" className="h-11 w-full px-5 text-[0.95rem] sm:w-auto">
              <Link href="#tarifs">
                Choisir une offre <ArrowRight />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="h-11 w-full px-5 text-[0.95rem] sm:w-auto">
              <Link href="#fonctionnement">Voir le fonctionnement</Link>
            </Button>
          </div>
          <ul className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
            <li className="inline-flex items-center gap-1.5">
              <CalendarClock className="size-4 text-brand" /> Préparateur attribué sous 24 h
            </li>
            <li className="inline-flex items-center gap-1.5">
              <CreditCard className="size-4 text-brand" /> Sans engagement
            </li>
            <li className="inline-flex items-center gap-1.5">
              <ShieldCheck className="size-4 text-brand" /> Paiement sécurisé par Whop
            </li>
          </ul>
        </div>
        <div className="mt-16 animate-in fade-in slide-in-from-bottom-6 duration-1000 sm:mt-20">
          <ProductMock />
        </div>
      </Container>
    </section>
  );
}
