import { db } from "@/server/db";
import { getSetting } from "@/server/services/settings";
import { Hero } from "@/components/marketing/hero";
import { HowItWorks } from "@/components/marketing/how-it-works";
import { Preparers } from "@/components/marketing/preparers";
import { Lockers } from "@/components/marketing/lockers";
import { Benefits } from "@/components/marketing/benefits";
import { Pricing } from "@/components/marketing/pricing";
import { Faq } from "@/components/marketing/faq";
import { Contact } from "@/components/marketing/contact";
import { FinalCta } from "@/components/marketing/final-cta";
import { Container, SectionHeading } from "@/components/marketing/section";

export const revalidate = 300;

export default async function HomePage() {
  const [plans, sizeRules, packs, suppliers, assignment, credits, support] = await Promise.all([
    db.plan.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } }),
    db.parcelSizeRule.findMany({ orderBy: { sortOrder: "asc" } }),
    db.creditPack.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } }),
    db.supplier.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } }),
    getSetting("assignment"),
    getSetting("credits"),
    getSetting("support"),
  ]);

  return (
    <>
      <Hero />
      <section id="fonctionnement" className="scroll-mt-20 py-24 sm:py-28">
        <Container className="space-y-14">
          <SectionHeading
            eyebrow="Fonctionnement"
            title="De votre achat à la livraison de votre acheteur"
            description="Cinq étapes, toutes visibles depuis votre tableau de bord. Vous gardez la main sur ce qui est expédié ; votre préparateur s'occupe du reste."
          />
          <HowItWorks sizeRules={sizeRules.map((r) => ({ size: r.size, label: r.label, creditCost: r.creditCost }))} />
        </Container>
      </section>
      <Preparers />
      <Lockers
        suppliers={suppliers.map((s) => ({
          code: s.code,
          name: s.name,
          acceptedLocationTypes: s.acceptedLocationTypes,
          compatibilityNotes: s.compatibilityNotes,
          requiresPickupCode: s.requiresPickupCode,
        }))}
      />
      <Benefits />
      <Pricing plans={plans} sizeRules={sizeRules} packs={packs} customPurchase={await getSetting("creditPurchase")} />
      <Faq
        ctx={{
          slaHours: assignment.slaHours,
          monthlyPolicy: credits.monthly.mode,
          rolloverMonths: credits.monthly.rolloverMonths,
          purchasedPolicy: credits.purchased.mode,
          purchasedDays: credits.purchased.days,
          storage: plans.map((p) => ({ name: p.name, limit: p.storageLimit })),
          sizes: sizeRules.map((r) => ({ label: r.label, cost: r.creditCost })),
        }}
      />
      <Contact support={support} />
      <FinalCta />
    </>
  );
}
