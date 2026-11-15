import Link from "next/link";
import { ArrowRight, Check, Info, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Container, SectionHeading } from "./section";

type Plan = { id: string; code: string; name: string; tagline: string | null; priceCents: number; currency: string; monthlyCredits: number; storageLimit: number | null; features: string[]; highlighted: boolean };
type SizeRule = { size: string; label: string; description: string | null; creditCost: number; maxLengthCm: number | null; maxWidthCm: number | null; maxHeightCm: number | null; maxWeightGrams: number | null };
type Pack = { id: string; name: string; credits: number; priceCents: number; currency: string };

function dims(r: SizeRule) {
  const parts: string[] = [];
  if (r.maxLengthCm && r.maxWidthCm && r.maxHeightCm) parts.push(`${r.maxLengthCm} × ${r.maxWidthCm} × ${r.maxHeightCm} cm`);
  if (r.maxWeightGrams) parts.push(`${(r.maxWeightGrams / 1000).toLocaleString("fr-FR")} kg max`);
  return parts.join(" · ") || "Selon appréciation du préparateur";
}

export function Pricing({ plans, sizeRules, packs }: { plans: Plan[]; sizeRules: SizeRule[]; packs: Pack[] }) {
  return (
    <section id="tarifs" className="scroll-mt-20 py-24 sm:py-28">
      <Container className="space-y-14">
        <SectionHeading
          eyebrow="Tarifs"
          title="Un abonnement simple, des crédits pour chaque colis"
          description="Chaque offre inclut un préparateur attitré, le tableau de bord, le suivi du stock et la messagerie. Sans engagement : résiliable à tout moment, effectif à la fin du mois en cours."
        />
        <div className={cn("grid gap-5", plans.length >= 3 ? "lg:grid-cols-3" : "md:grid-cols-2")}>
          {plans.map((p) => (
            <div
              key={p.id}
              className={cn(
                "relative flex flex-col rounded-3xl border bg-card p-7 shadow-soft",
                p.highlighted && "border-brand/50 bg-gradient-to-b from-brand-soft/70 to-card glow-brand lg:-my-3 lg:py-10",
              )}
            >
              {p.highlighted && (
                <span className="absolute -top-3 left-7 rounded-full bg-brand px-3 py-1 text-xs font-semibold text-brand-foreground">Recommandé</span>
              )}
              <p className="text-lg font-semibold">{p.name}</p>
              {p.tagline && <p className="mt-1 min-h-10 text-sm text-muted-foreground">{p.tagline}</p>}
              <p className="mt-6 flex items-baseline gap-1.5">
                <span className="text-4xl font-semibold tracking-tight tabular">{formatMoney(p.priceCents, p.currency)}</span>
                <span className="text-sm text-muted-foreground">/ mois</span>
              </p>
              <p className="mt-2 inline-flex w-fit items-center gap-1.5 rounded-full bg-brand-soft px-2.5 py-1 text-xs font-medium text-brand">
                {p.monthlyCredits} crédits par mois
              </p>
              <ul className="mt-7 flex-1 space-y-3">
                {p.features.map((f) => (
                  <li key={f} className="flex gap-2.5 text-sm">
                    <Check className="mt-0.5 size-4 shrink-0 text-brand" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <Button asChild size="lg" variant={p.highlighted ? "default" : "outline"} className="mt-8 h-11 w-full text-[0.95rem]">
                <Link href={`/inscription?offre=${p.code}`}>
                  Choisir {p.name} <ArrowRight />
                </Link>
              </Button>
            </div>
          ))}
        </div>
        <p className="text-center text-xs text-muted-foreground">Tarifs TTC, renouvelés automatiquement tous les 30 jours via Whop. Les codes promotionnels peuvent être saisis lors du paiement.</p>

        <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
          <div className="rounded-3xl border bg-card p-6 sm:p-7">
            <div className="flex items-center gap-2">
              <Package className="size-4 text-brand" />
              <p className="font-semibold">Coût de préparation par colis</p>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">La taille réelle est déterminée par votre préparateur, selon les règles ci-dessous. Vous êtes notifié avant tout débit.</p>
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              {sizeRules.map((r) => (
                <div key={r.size} className="rounded-2xl bg-muted/50 p-4">
                  <p className="text-sm font-medium">{r.label}</p>
                  <p className="mt-2 text-2xl font-semibold tabular">
                    {r.creditCost} <span className="text-sm font-normal text-muted-foreground">crédit{r.creditCost > 1 ? "s" : ""}</span>
                  </p>
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{dims(r)}</p>
                  {r.description && <p className="mt-1 text-xs text-muted-foreground">{r.description}</p>}
                </div>
              ))}
            </div>
          </div>
          <div className="flex flex-col rounded-3xl border bg-card p-6 sm:p-7">
            <p className="font-semibold">Crédits supplémentaires</p>
            <p className="mt-1 text-sm text-muted-foreground">Besoin de plus de crédits un mois donné ? Achetez 10, 30, 50 ou 100 crédits depuis votre espace, sans changer d&apos;offre.</p>
            <ul className="mt-5 divide-y rounded-2xl border">
              {packs.map((pk) => (
                <li key={pk.id} className="flex items-center justify-between px-4 py-3 text-sm">
                  <span>
                    <span className="font-medium">{pk.credits} crédits</span>
                    <span className="ml-2 text-xs text-muted-foreground">{formatMoney(Math.round(pk.priceCents / pk.credits), pk.currency)} / crédit</span>
                  </span>
                  <span className="font-semibold tabular">{formatMoney(pk.priceCents, pk.currency)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="flex gap-3 rounded-2xl border bg-muted/40 p-5 text-sm">
          <Info className="mt-0.5 size-4 shrink-0 text-brand" />
          <p className="leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">Frais de transport non inclus.</span> Les crédits couvrent la réception, le stockage et la préparation. L&apos;affranchissement est
            distinct : vous fournissez votre propre étiquette (par exemple celle générée par Vinted), ou les frais d&apos;envoi vous sont indiqués et facturés séparément.
          </p>
        </div>
      </Container>
    </section>
  );
}
