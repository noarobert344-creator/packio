-- Suivi des appels à l'IA de secours de Packio Connect (coût, plafonds).
-- CreateTable
CREATE TABLE "ai_usages" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "platform" "MarketplacePlatform" NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "costMicros" INTEGER NOT NULL DEFAULT 0,
    "succeeded" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,
    "salesFound" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_usages_customerId_createdAt_idx" ON "ai_usages"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "ai_usages_createdAt_idx" ON "ai_usages"("createdAt");

-- AddForeignKey
ALTER TABLE "ai_usages" ADD CONSTRAINT "ai_usages_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

