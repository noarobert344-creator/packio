import { Boxes, Check, Coins, LayoutDashboard, MessagesSquare, Package, Truck, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";

const ORDER_STEPS = [
  { label: "Commande enregistrée", done: true },
  { label: "Disponible au locker", done: true },
  { label: "Récupérée par le préparateur", done: true },
  { label: "Contrôle qualité en cours", active: true },
  { label: "En stock" },
];

/** Aperçu illustratif de l'interface (données d'exemple). */
export function ProductMock() {
  return (
    <figure className="relative mx-auto w-full max-w-5xl">
      <div className="absolute -inset-x-6 -top-10 -bottom-6 -z-10 rounded-[2.5rem] bg-gradient-to-b from-brand/20 via-brand/5 to-transparent blur-2xl" aria-hidden />
      <div className="overflow-hidden rounded-2xl border bg-card shadow-[0_30px_80px_-30px_color-mix(in_oklch,var(--brand)_45%,transparent)] ring-1 ring-black/5 dark:ring-white/5">
        <div className="flex items-center gap-2 border-b bg-muted/40 px-4 py-2.5">
          <span className="size-2.5 rounded-full bg-foreground/15" />
          <span className="size-2.5 rounded-full bg-foreground/15" />
          <span className="size-2.5 rounded-full bg-foreground/15" />
          <span className="mx-auto rounded-md bg-background/80 px-3 py-0.5 text-[0.7rem] text-muted-foreground ring-1 ring-border">packio — Espace client</span>
        </div>
        <div className="grid md:grid-cols-[11.5rem_1fr]">
          <aside className="hidden border-r bg-sidebar p-3 md:block" aria-hidden>
            {[
              { icon: LayoutDashboard, label: "Vue d'ensemble", active: true },
              { icon: UserRound, label: "Mon préparateur" },
              { icon: Package, label: "Mes commandes" },
              { icon: Boxes, label: "Mon stock" },
              { icon: Truck, label: "Mes expéditions" },
              { icon: MessagesSquare, label: "Messages" },
              { icon: Coins, label: "Mes crédits" },
            ].map((i) => (
              <div key={i.label} className={cn("mb-0.5 flex items-center gap-2 rounded-md px-2 py-1.5 text-[0.72rem]", i.active ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground" : "text-muted-foreground")}>
                <i.icon className={cn("size-3.5", i.active && "text-brand")} />
                {i.label}
              </div>
            ))}
          </aside>
          <div className="grid gap-3 bg-muted/20 p-3 sm:grid-cols-2 sm:p-4">
            <div className="rounded-xl border bg-card p-4 sm:col-span-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-3">
                  <span className="inline-flex size-9 items-center justify-center rounded-full bg-brand-soft text-xs font-semibold text-brand">CM</span>
                  <div>
                    <p className="text-sm font-semibold">Camille M.</p>
                    <p className="text-[0.72rem] text-muted-foreground">Votre préparatrice · Lyon</p>
                  </div>
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-success-soft px-2.5 py-1 text-[0.7rem] font-medium text-success ring-1 ring-inset ring-success/20">
                  <span className="size-1.5 rounded-full bg-current" /> Disponible
                </span>
              </div>
            </div>
            <div className="rounded-xl border bg-card p-4">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-[0.8rem] font-semibold">Veste en jean</p>
                <span className="text-[0.68rem] text-muted-foreground">Vinted</span>
              </div>
              <ol className="space-y-2.5">
                {ORDER_STEPS.map((s) => (
                  <li key={s.label} className="flex items-center gap-2.5 text-[0.72rem]">
                    <span
                      className={cn(
                        "inline-flex size-4 shrink-0 items-center justify-center rounded-full",
                        s.done ? "bg-brand text-brand-foreground" : s.active ? "bg-brand-soft ring-2 ring-brand" : "bg-muted ring-1 ring-border",
                      )}
                    >
                      {s.done && <Check className="size-2.5" strokeWidth={3} />}
                    </span>
                    <span className={cn(s.done || s.active ? "text-foreground" : "text-muted-foreground", s.active && "font-medium")}>{s.label}</span>
                  </li>
                ))}
              </ol>
            </div>
            <div className="grid gap-3">
              <div className="rounded-xl border bg-card p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-[0.68rem] text-muted-foreground">Expédition · EXP-7K2M9QX</p>
                    <p className="text-[0.8rem] font-semibold">Moyen colis · 2 crédits</p>
                  </div>
                  <span className="rounded-full bg-info-soft px-2 py-0.5 text-[0.65rem] font-medium text-info ring-1 ring-inset ring-info/20">Crédits réservés</span>
                </div>
                <div className="mt-3 flex gap-1">
                  {[1, 1, 1, 0.6, 0, 0].map((v, i) => (
                    <span key={i} className={cn("h-1.5 flex-1 rounded-full", v === 1 ? "bg-brand" : v > 0 ? "bg-brand/60" : "bg-muted")} />
                  ))}
                </div>
                <p className="mt-2 text-[0.68rem] text-muted-foreground">Préparation en cours</p>
              </div>
              <div className="flex items-center gap-3 rounded-xl border bg-card p-4">
                <span className="inline-flex size-10 items-center justify-center rounded-lg bg-muted">
                  <Boxes className="size-4 text-muted-foreground" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[0.8rem] font-semibold">Sneakers · taille 39</p>
                  <p className="text-[0.68rem] text-muted-foreground">SKU-4F8D2A1 · Emplacement C-01</p>
                </div>
                <span className="rounded-full bg-success-soft px-2 py-0.5 text-[0.65rem] font-medium text-success ring-1 ring-inset ring-success/20">En stock</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      <figcaption className="mt-4 text-center text-xs text-muted-foreground">Aperçu de l&apos;interface — données d&apos;exemple.</figcaption>
    </figure>
  );
}
