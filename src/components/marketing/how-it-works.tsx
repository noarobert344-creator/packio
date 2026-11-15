"use client";

import { useState } from "react";
import { Bell, Camera, Check, ClipboardCheck, Copy, CreditCard, MapPin, PackageCheck, ShoppingBag, Truck, UserRoundCheck } from "lucide-react";
import { cn } from "@/lib/utils";

type SizeRule = { size: string; label: string; creditCost: number };

const STEPS = [
  {
    icon: CreditCard,
    title: "Choisissez votre offre",
    text: "Souscrivez un abonnement mensuel adapté à votre volume. Vos crédits de préparation sont disponibles dès le paiement, géré de façon sécurisée par Whop.",
  },
  {
    icon: UserRoundCheck,
    title: "Votre préparateur vous est attribué",
    text: "L'équipe Packio sélectionne manuellement le préparateur le plus adapté, sous 24 heures. Vous êtes notifié et son point de réception s'active dans votre espace.",
  },
  {
    icon: ShoppingBag,
    title: "Commandez vers son point de réception",
    text: "Achetez sur Vinted, SHEIN, AliExpress, ZenMarket ou ailleurs, en livraison vers l'adresse ou le locker validé de votre préparateur, puis déclarez la commande.",
  },
  {
    icon: PackageCheck,
    title: "Réception, contrôle et mise en stock",
    text: "Votre préparateur récupère le colis, vérifie le contenu, le photographie et le range. Chaque article apparaît dans votre stock avec sa référence et son emplacement.",
  },
  {
    icon: Truck,
    title: "Demandez une expédition",
    text: "Sélectionnez les articles et le destinataire. Le préparateur classe le colis, le prépare et le dépose chez le transporteur : les crédits sont débités au dépôt.",
  },
];

function Panel({ step, sizeRules }: { step: number; sizeRules: SizeRule[] }) {
  switch (step) {
    case 0:
      return (
        <div className="space-y-3">
          {["Starter", "Pro", "Business"].map((p, i) => (
            <div key={p} className={cn("flex items-center justify-between rounded-xl border bg-card px-4 py-3 text-sm", i === 1 && "border-brand ring-2 ring-brand/20")}>
              <span className="font-medium">{p}</span>
              <span className={cn("inline-flex size-5 items-center justify-center rounded-full border", i === 1 && "border-brand bg-brand text-brand-foreground")}>{i === 1 && <Check className="size-3" />}</span>
            </div>
          ))}
          <div className="rounded-xl bg-success-soft px-4 py-3 text-sm text-success">Abonnement actif — crédits disponibles</div>
        </div>
      );
    case 1:
      return (
        <div className="space-y-3">
          <div className="rounded-xl border bg-card p-4">
            <p className="text-xs text-muted-foreground">Statut de l&apos;attribution</p>
            <div className="mt-3 flex items-center gap-2">
              {["En attente", "Attribué"].map((s, i) => (
                <span key={s} className={cn("rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset", i === 1 ? "bg-success-soft text-success ring-success/20" : "bg-muted text-muted-foreground ring-border")}>
                  {s}
                </span>
              ))}
            </div>
          </div>
          <div className="flex items-start gap-3 rounded-xl border bg-card p-4">
            <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand">
              <Bell className="size-4" />
            </span>
            <div>
              <p className="text-sm font-medium">Votre préparateur est disponible</p>
              <p className="text-xs text-muted-foreground">Son point de réception est désormais visible dans « Commander des articles ».</p>
            </div>
          </div>
        </div>
      );
    case 2:
      return (
        <div className="space-y-3">
          <div className="rounded-xl border bg-card p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <MapPin className="size-3.5" /> Point de réception validé · Locker
            </div>
            <p className="mt-2 text-sm font-medium">Destinataire : Camille M. — PK-XXXXX</p>
            <p className="text-sm text-muted-foreground">Adresse du locker affichée dans votre espace</p>
            <span className="mt-3 inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs">
              <Copy className="size-3.5" /> Copier l&apos;adresse
            </span>
          </div>
          <div className="rounded-xl border bg-card p-4 text-sm">
            <p className="font-medium">Code de retrait</p>
            <p className="text-xs text-muted-foreground">Transmettez-le à votre préparateur dès réception : il récupère le colis à votre place.</p>
          </div>
        </div>
      );
    case 3:
      return (
        <div className="space-y-3">
          <div className="flex items-center gap-3 rounded-xl border bg-card p-4">
            <span className="inline-flex size-12 items-center justify-center rounded-lg bg-muted">
              <Camera className="size-5 text-muted-foreground" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">Article photographié à la réception</p>
              <p className="text-xs text-muted-foreground">Quantité contrôlée · état vérifié</p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            {[
              ["Reçus", "1"],
              ["Disponibles", "1"],
              ["Emplacement", "C-01"],
            ].map(([k, v]) => (
              <div key={k} className="rounded-xl border bg-card px-2 py-3">
                <p className="text-sm font-semibold">{v}</p>
                <p className="text-[0.7rem] text-muted-foreground">{k}</p>
              </div>
            ))}
          </div>
        </div>
      );
    default:
      return (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            {sizeRules.map((r, i) => (
              <div key={r.size} className={cn("rounded-xl border bg-card px-2 py-3 text-center", i === 1 && "border-brand ring-2 ring-brand/20")}>
                <p className="text-xs font-medium">{r.label}</p>
                <p className="mt-1 text-lg font-semibold">{r.creditCost}</p>
                <p className="text-[0.7rem] text-muted-foreground">crédit{r.creditCost > 1 ? "s" : ""}</p>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-3 rounded-xl border bg-card p-4">
            <span className="inline-flex size-8 items-center justify-center rounded-lg bg-success-soft text-success">
              <ClipboardCheck className="size-4" />
            </span>
            <div>
              <p className="text-sm font-medium">Déposé au transporteur</p>
              <p className="text-xs text-muted-foreground">Numéro de suivi transmis · crédits débités</p>
            </div>
          </div>
        </div>
      );
  }
}

export function HowItWorks({ sizeRules }: { sizeRules: SizeRule[] }) {
  const [active, setActive] = useState(0);
  return (
    <div className="grid items-start gap-8 lg:grid-cols-[1fr_26rem] lg:gap-12">
      <ol className="relative space-y-2" role="tablist" aria-label="Étapes du fonctionnement">
        <span className="absolute top-6 bottom-6 left-[1.6rem] w-px bg-border" aria-hidden />
        {STEPS.map((s, i) => {
          const isActive = i === active;
          return (
            <li key={s.title}>
              <button
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-controls="how-panel"
                onClick={() => setActive(i)}
                onMouseEnter={() => setActive(i)}
                className={cn(
                  "relative flex w-full gap-4 rounded-2xl p-3 text-left transition-colors",
                  isActive ? "bg-card shadow-soft ring-1 ring-border" : "hover:bg-muted/50",
                )}
              >
                <span
                  className={cn(
                    "relative z-10 inline-flex size-[2.2rem] shrink-0 items-center justify-center rounded-xl ring-4 ring-background transition-colors",
                    isActive ? "bg-brand text-brand-foreground" : "bg-muted text-muted-foreground",
                  )}
                >
                  <s.icon className="size-4" />
                </span>
                <span className="min-w-0 pt-0.5">
                  <span className="text-xs font-medium text-muted-foreground">Étape {i + 1}</span>
                  <span className="block font-semibold">{s.title}</span>
                  <span className={cn("block text-sm leading-relaxed text-muted-foreground", !isActive && "line-clamp-1 lg:line-clamp-none")}>{s.text}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <div id="how-panel" role="tabpanel" className="rounded-3xl border bg-muted/40 p-4 sm:p-6 lg:sticky lg:top-24">
        <div className="mb-4 flex items-center justify-between">
          <p className="text-sm font-semibold">{STEPS[active].title}</p>
          <span className="text-xs text-muted-foreground">
            {active + 1} / {STEPS.length}
          </span>
        </div>
        <div key={active} className="min-h-[15rem] animate-in fade-in slide-in-from-bottom-1 duration-300">
          <Panel step={active} sizeRules={sizeRules} />
        </div>
        <p className="mt-4 text-center text-[0.7rem] text-muted-foreground">Illustration — données d&apos;exemple</p>
      </div>
    </div>
  );
}
