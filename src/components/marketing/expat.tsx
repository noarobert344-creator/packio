import { Globe2, Plane, Smartphone } from "lucide-react";
import { Container } from "./section";

/** Bandeau : l'achat-revente depuis n'importe où (expatriation, voyages). */
export function Expat() {
  return (
    <section className="py-10 sm:py-14">
      <Container>
        <div data-reveal className="relative overflow-hidden rounded-3xl border bg-gradient-to-br from-brand-soft/80 via-card to-card p-6 shadow-soft sm:p-10">
          <div className="pointer-events-none absolute -top-24 -right-16 size-72 rounded-full bg-brand/15 blur-3xl animate-aurora-slow" aria-hidden />
          <div className="relative grid items-center gap-8 lg:grid-cols-[1.2fr_1fr]">
            <div>
              <p className="inline-flex items-center gap-2 text-xs font-semibold tracking-[0.18em] text-brand uppercase">
                <Globe2 className="size-4" /> Où que vous soyez
              </p>
              <h2 className="mt-3 text-2xl font-semibold tracking-tight text-balance sm:text-3xl">Une solution pour s&apos;expatrier et faire de l&apos;achat-revente depuis où vous voulez.</h2>
              <p className="mt-3 text-muted-foreground">Votre stock reste en France chez votre préparateur. Vous achetez, vendez et suivez chaque colis depuis votre téléphone.</p>
            </div>
            <ul className="grid gap-3 text-sm">
              {[
                { icon: Plane, text: "Expatrié, en voyage ou en déplacement : vos ventes continuent." },
                { icon: Smartphone, text: "Tout se pilote depuis votre espace : commandes, ventes, bordereaux, messages." },
                { icon: Globe2, text: "Vos colis partent de France, sous 48 h, sans que vous ayez à y toucher." },
              ].map((i, n) => (
                <li key={i.text} data-reveal="right" style={{ "--d": `${n * 90}ms` } as React.CSSProperties} className="flex gap-3 rounded-2xl border bg-background/70 p-3.5 backdrop-blur">
                  <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
                    <i.icon className="size-4" />
                  </span>
                  <span className="pt-1.5">{i.text}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Container>
    </section>
  );
}
