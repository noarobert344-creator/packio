-- Ventes : compte d'origine, taille, photo, date limite d'envoi, annulation,
-- colis parti hors Packio, ventes ajoutées à la main et ventes en lot.

-- AlterTable
ALTER TABLE "marketplace_sales" ADD COLUMN     "accountId" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "manual" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "photoUrl" TEXT,
ADD COLUMN     "platformShippedAt" TIMESTAMP(3),
ADD COLUMN     "shipBy" TIMESTAMP(3),
ADD COLUMN     "shipByEstimated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "size" TEXT;

-- CreateTable
CREATE TABLE "marketplace_sale_lines" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "externalItemId" TEXT,
    "title" TEXT NOT NULL,
    "size" TEXT,
    "photoUrl" TEXT,
    "priceCents" INTEGER,
    "listingId" TEXT,
    "inventoryItemId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marketplace_sale_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "marketplace_sale_lines_inventoryItemId_idx" ON "marketplace_sale_lines"("inventoryItemId");

-- CreateIndex
CREATE UNIQUE INDEX "marketplace_sale_lines_saleId_position_key" ON "marketplace_sale_lines"("saleId", "position");

-- CreateIndex
CREATE INDEX "marketplace_sales_accountId_idx" ON "marketplace_sales"("accountId");

-- AddForeignKey
ALTER TABLE "marketplace_sales" ADD CONSTRAINT "marketplace_sales_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "marketplace_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_sale_lines" ADD CONSTRAINT "marketplace_sale_lines_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "marketplace_sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_sale_lines" ADD CONSTRAINT "marketplace_sale_lines_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "marketplace_listings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_sale_lines" ADD CONSTRAINT "marketplace_sale_lines_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "inventory_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Ventes existantes : rattachées au compte quand le client n'en a qu'un sur la plateforme.
UPDATE "marketplace_sales" AS s
SET "accountId" = a."id"
FROM "marketplace_accounts" AS a
WHERE s."accountId" IS NULL
  AND a."customerId" = s."customerId"
  AND a."platform" = s."platform"
  AND (SELECT count(*) FROM "marketplace_accounts" AS a2 WHERE a2."customerId" = s."customerId" AND a2."platform" = s."platform") = 1;

