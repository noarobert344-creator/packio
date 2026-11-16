import Link from "next/link";
import { ArrowRight, CalendarClock, ShieldCheck, Timer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Container } from "./section";
import { ProductMock } from "./product-mock";

/** Plateformes et fournisseurs pris en charge (bandeau défilant). */
const PLATFORMS = ["Vinted", "Vestiaire Collective", "Whatnot", "ZenMarket", "Temu", "SHEIN", "AliExpress"];

export function Hero({ shippingHours }: { shippingHours: number }) {
  return (
    <section className="relative overflow-hidden pt-16 pb-16 sm:pt-24 sm:pb-20">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-grid mask-radial opacity-70" aria-hidden />
      <div className="pointer-events-none absolute top-[-14rem] left-1/2 -z-10 size-[46rem] rounded-full bg-brand/20 blur-3xl animate-aurora" aria-hidden />
      <div className="pointer-events-none absolute top-[-6rem] left-[62%] -z-10 size-[26rem] rounded-full bg-[oklch(0.7_0.17_230)]/15 blur-3xl animate-aurora-slow" aria-hidden />
      <Container>
        <div className="mx-auto max-w-3xl text-center">
          <p className="mx-auto mb-6 inline-flex items-center gap-2 rounded-full border bg-background/80 px-3 py-1 text-xs font-medium text-muted-foreground shadow-soft backdrop-blur animate-in fade-in slide-in-from-bottom-2 duration-700">
            <span className="relative flex size-1.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand opacity-70" />
              <span className="relative inline-flex size-1.5 rounded-full bg-brand" />
            </span>
            Logistique e-commerce déléguée
          </p>
          <h1 className="text-4xl font-semibold tracking-tight text-balance animate-in fade-in slide-in-from-bottom-4 duration-700 delay-100 fill-mode-both sm:text-6xl sm:leading-[1.05]">
            Déléguez vos colis à un <span className="text-gradient-brand">préparateur attitré</span>.
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-muted-foreground text-balance animate-in fade-in slide-in-from-bottom-4 duration-700 delay-200 fill-mode-both sm:text-lg">
            Vos achats arrivent chez votre préparateur : photographiés comme des pros, parfumés, emballés avec soin et expédiés à vos acheteurs sous {shippingHours} h.
          </p>
          <div className="mt-9 flex flex-col items-center justify-center gap-3 animate-in fade-in slide-in-from-bottom-4 duration-700 delay-300 fill-mode-both sm:flex-row">
            <Button asChild size="lg" className="btn-shine h-11 w-full px-5 text-[0.95rem] sm:w-auto">
              <Link href="#tarifs">
                Choisir une offre <ArrowRight />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="h-11 w-full px-5 text-[0.95rem] sm:w-auto">
              <Link href="#fonctionnement">Voir le fonctionnement</Link>
            </Button>
          </div>
          <ul className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-muted-foreground animate-in fade-in duration-1000 delay-500 fill-mode-both">
            <li className="inline-flex items-center gap-1.5">
              <CalendarClock className="size-4 text-brand" /> Préparateur sous 24 h
            </li>
            <li className="inline-flex items-center gap-1.5">
              <Timer className="size-4 text-brand" /> Colis expédiés sous {shippingHours} h
            </li>
            <li className="inline-flex items-center gap-1.5">
              <ShieldCheck className="size-4 text-brand" /> Paiement sécurisé
            </li>
          </ul>
        </div>
        <div className="mt-14 animate-in fade-in slide-in-from-bottom-8 duration-1000 delay-300 fill-mode-both sm:mt-16">
          <div className="animate-float [animation-duration:8s]">
            <ProductMock />
          </div>
        </div>
        <div className="marquee mt-14 sm:mt-16" aria-label="Plateformes et fournisseurs pris en charge">
          <p className="mb-4 text-center text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">Vos ventes et vos achats, au même endroit</p>
          <div className="overflow-hidden mask-fade-x">
            <ul className="flex w-max animate-marquee gap-3">
              {[...PLATFORMS, ...PLATFORMS, ...PLATFORMS, ...PLATFORMS].map((name, i) => (
                <li
                  key={`${name}-${i}`}
                  aria-hidden={i >= PLATFORMS.length}
                  className="rounded-full border bg-card/70 px-5 py-2 text-sm font-medium whitespace-nowrap text-foreground/80 shadow-soft backdrop-blur"
                >
                  {name}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Container>
    </section>
  );
}
