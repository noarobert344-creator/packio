import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Scale } from "lucide-react";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { getSetting } from "@/server/services/settings";
import { LEGAL_DOCS, type LegalSlug } from "@/components/marketing/legal-docs";
import { Container } from "@/components/marketing/section";
import { cn } from "@/lib/utils";

function isSlug(s: string): s is LegalSlug {
  return s in LEGAL_DOCS;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  if (!isSlug(slug)) return { title: "Page introuvable" };
  return { title: LEGAL_DOCS[slug].title, description: LEGAL_DOCS[slug].description };
}

export default async function LegalPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!isSlug(slug)) notFound();
  const [legal, support, credits, assignment, messaging, sizeRules] = await Promise.all([
    getSetting("legal"),
    getSetting("support"),
    getSetting("credits"),
    getSetting("assignment"),
    getSetting("messaging"),
    db.parcelSizeRule.findMany({ orderBy: { sortOrder: "asc" }, select: { label: true, creditCost: true } }),
  ]);
  const doc = LEGAL_DOCS[slug];
  const Doc = doc.Component;
  return (
    <Container className="py-14 sm:py-20">
      <div className="grid gap-10 lg:grid-cols-[14rem_1fr] lg:gap-14">
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <p className="mb-3 text-xs font-semibold tracking-[0.18em] text-muted-foreground uppercase">Informations légales</p>
          <nav className="flex gap-1 overflow-x-auto pb-1 scrollbar-none lg:flex-col" aria-label="Documents légaux">
            {(Object.keys(LEGAL_DOCS) as LegalSlug[]).map((s) => (
              <Link
                key={s}
                href={`/legal/${s}`}
                aria-current={s === slug ? "page" : undefined}
                className={cn(
                  "shrink-0 rounded-lg px-3 py-2 text-sm whitespace-nowrap transition-colors",
                  s === slug ? "bg-brand-soft font-medium text-brand" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {LEGAL_DOCS[s].title}
              </Link>
            ))}
          </nav>
        </aside>
        <article className="max-w-3xl min-w-0">
          <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">{doc.title}</h1>
          <p className="mt-3 text-muted-foreground">{doc.description}</p>
          <p className="mt-6 flex items-start gap-2.5 rounded-xl border border-warning/30 bg-warning-soft/60 px-4 py-3 text-sm">
            <Scale className="mt-0.5 size-4 shrink-0 text-warning" />
            <span>Modèle à faire valider par un professionnel du droit avant mise en production. Les mentions « [À compléter] » se renseignent dans le back-office (Paramètres → Légal).</span>
          </p>
          <div
            className={cn(
              "mt-10 text-[0.95rem] leading-relaxed text-foreground/85",
              "[&_h2]:mt-10 [&_h2]:mb-3 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-foreground [&_h2:first-child]:mt-0",
              "[&_p]:my-3 [&_ul]:my-3 [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5 [&_li]:marker:text-muted-foreground",
              "[&_a]:font-medium [&_a]:text-brand [&_a]:underline-offset-2 hover:[&_a]:underline [&_strong]:font-semibold [&_strong]:text-foreground",
            )}
          >
            <Doc
              ctx={{
                legal,
                support,
                credits,
                slaHours: assignment.slaHours,
                supervisionMinutes: messaging.supervisionMinutes,
                appUrl: env.appUrl,
                sizes: sizeRules,
              }}
            />
          </div>
          <p className="mt-12 border-t pt-6 text-xs text-muted-foreground">Dernière mise à jour du modèle : {new Date().getFullYear()}.</p>
        </article>
      </div>
    </Container>
  );
}
