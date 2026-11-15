-- CreateEnum
CREATE TYPE "BillingInterval" AS ENUM ('MONTHLY', 'YEARLY');

-- AlterTable
ALTER TABLE "plans" ADD COLUMN     "annualPriceCents" INTEGER,
ADD COLUMN     "whopAnnualPlanId" TEXT;

-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN     "billingInterval" "BillingInterval" NOT NULL DEFAULT 'MONTHLY',
ADD COLUMN     "creditAnchorAt" TIMESTAMP(3),
ADD COLUMN     "creditMonthsGranted" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "nextCreditGrantAt" TIMESTAMP(3),
ADD COLUMN     "pendingBillingInterval" "BillingInterval",
ADD COLUMN     "pendingSyncedAt" TIMESTAMP(3),
ADD COLUMN     "supersededAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "plans_whopAnnualPlanId_key" ON "plans"("whopAnnualPlanId");

-- CreateIndex
CREATE INDEX "subscriptions_nextCreditGrantAt_idx" ON "subscriptions"("nextCreditGrantAt");

-- Intégrité
ALTER TABLE "plans"
  ADD CONSTRAINT "plans_annual_price_positive" CHECK ("annualPriceCents" IS NULL OR "annualPriceCents" > 0);
ALTER TABLE "subscriptions"
  ADD CONSTRAINT "subscriptions_credit_months_range" CHECK ("creditMonthsGranted" BETWEEN 0 AND 12);

-- Prix annuel initial : 10 mois (2 mois offerts). Seules les offres sans prix
-- annuel sont concernées ; la valeur reste modifiable dans le back-office.
UPDATE "plans" SET "annualPriceCents" = "priceCents" * 10 WHERE "annualPriceCents" IS NULL;
