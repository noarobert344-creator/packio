import { db } from "@/server/db";
import { getSetting } from "@/server/services/settings";
import { Hero } from "@/components/marketing/hero";
import { Expat } from "@/components/marketing/expat";
import { HowItWorks } from "@/components/marketing/how-it-works";
import { Preparers } from "@/components/marketing/preparers";
import { Services } from "@/components/marketing/services";
import { Testimonials } from "@/components/marketing/testimonials";
import { Pricing } from "@/components/marketing/pricing";
import { Faq } from "@/components/marketing/faq";
import { Contact } from "@/components/marketing/contact";
import { FinalCta } from "@/components/marketing/final-cta";
import { Container, SectionHeading } from "@/components/marketing/section";
import { MotionEffects } from "@/components/marketing/motion";
import { commonAnnualBadge } from "@/lib/billing-intervals";

// Rendu à chaque requête : les prix et réglages viennent de la base (aucun accès à la base pendant la construction).
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [plans, sizeRules, packs, assignment, credits, support, storage, shipping] = await Promise.all([
    db.plan.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } }),
    db.parcelSizeRule.findMany({ orderBy: { sortOrder: "asc" } }),
    db.creditPack.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } }),
    getSetting("assignment"),
    getSetting("credits"),
    getSetting("support"),
    getSetting("storage"),
    getSetting("shipping"),
  ]);

  return (
    <>
      <MotionEffects />
      <Hero shippingHours={shipping.slaHours} />
      <Expat />
      <section id="fonctionnement" className="scroll-mt-20 py-24 sm:py-28">
        <Container className="space-y-14">
          <SectionHeading
            eyebrow="Fonctionnement"
            title="De votre achat à la livraison de votre acheteur"
            description="Cinq étapes, toutes suivies depuis votre tableau de bord."
          />
          <HowItWorks sizeRules={sizeRules.map((r) => ({ size: r.size, label: r.label, creditCost: r.creditCost }))} shippingHours={shipping.slaHours} />
        </Container>
      </section>
      <Preparers shippingHours={shipping.slaHours} />
      <Services shippingHours={shipping.slaHours} returnCredits={shipping.returnCredits} />
      <Testimonials />
      <Pricing plans={plans} sizeRules={sizeRules} packs={packs} storage={storage} shippingHours={shipping.slaHours} returnCredits={shipping.returnCredits} addressDeliveryCredits={shipping.addressDeliveryCredits} />
      <Faq
        ctx={{
          slaHours: assignment.slaHours,
          monthlyPolicy: credits.monthly.mode,
          rolloverMonths: credits.monthly.rolloverMonths,
          purchasedPolicy: credits.purchased.mode,
          purchasedDays: credits.purchased.days,
          storage: plans.map((p) => ({ name: p.name, limit: p.storageLimit })),
          sizes: sizeRules.map((r) => ({ label: r.label, cost: r.creditCost })),
          storageRules: storage,
          shippingHours: shipping.slaHours,
          returnCredits: shipping.returnCredits,
          addressDeliveryCredits: shipping.addressDeliveryCredits,
          annualBadge: commonAnnualBadge(plans),
        }}
      />
      <Contact support={support} />
      <FinalCta />
    </>
  );
}
