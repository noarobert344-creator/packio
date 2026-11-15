-- =============================================================================
-- Passage de Stripe à Whop pour les paiements.
-- Les colonnes sont renommées (et non supprimées) lorsque leur contenu reste
-- pertinent ; seuls les identifiants propres à Stripe (prix, PaymentIntent)
-- sont retirés car inutilisables avec Whop.
-- =============================================================================

-- Client chez le prestataire de paiement
ALTER TABLE "customer_profiles" RENAME COLUMN "stripeCustomerId" TO "billingCustomerId";
ALTER INDEX "customer_profiles_stripeCustomerId_key" RENAME TO "customer_profiles_billingCustomerId_key";

-- Offres : plan Whop facultatif
DROP INDEX "plans_stripePriceId_key";
ALTER TABLE "plans" DROP COLUMN "stripePriceId", DROP COLUMN "stripeProductId", ADD COLUMN "whopPlanId" TEXT;
CREATE UNIQUE INDEX "plans_whopPlanId_key" ON "plans"("whopPlanId");

-- Recharges : plan Whop facultatif
ALTER TABLE "credit_packs" ADD COLUMN "whopPlanId" TEXT;
CREATE UNIQUE INDEX "credit_packs_whopPlanId_key" ON "credit_packs"("whopPlanId");

-- Abonnements : changement d'offre programmé au renouvellement
ALTER TABLE "subscriptions" ADD COLUMN "pendingPlanId" TEXT, ALTER COLUMN "provider" SET DEFAULT 'whop';
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_pendingPlanId_fkey" FOREIGN KEY ("pendingPlanId") REFERENCES "plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Paiements : rattachement à l'abonnement Whop
DROP INDEX "payments_paymentIntentId_key";
ALTER TABLE "payments" DROP COLUMN "paymentIntentId", ADD COLUMN "membershipId" TEXT, ALTER COLUMN "provider" SET DEFAULT 'whop';
CREATE INDEX "payments_membershipId_idx" ON "payments"("membershipId");

-- Journal des webhooks (générique)
ALTER TABLE "stripe_events" RENAME TO "webhook_events";
ALTER TABLE "webhook_events" RENAME CONSTRAINT "stripe_events_pkey" TO "webhook_events_pkey";
ALTER INDEX "stripe_events_type_receivedAt_idx" RENAME TO "webhook_events_type_receivedAt_idx";
ALTER TABLE "webhook_events" ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'stripe';
ALTER TABLE "webhook_events" ALTER COLUMN "provider" SET DEFAULT 'whop';
