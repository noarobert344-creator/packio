-- CreateEnum
CREATE TYPE "OrderMode" AS ENUM ('STOCK', 'DROPSHIP');

-- CreateEnum
CREATE TYPE "ShipmentKind" AS ENUM ('SALE', 'RETURN_TO_CUSTOMER', 'DROPSHIP');

-- CreateEnum
CREATE TYPE "MarketplacePlatform" AS ENUM ('VINTED', 'VESTIAIRE', 'OTHER');

-- CreateEnum
CREATE TYPE "MarketplaceSaleStatus" AS ENUM ('NEW', 'MATCHED', 'SHIPMENT_CREATED', 'IGNORED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "CreditTransactionType" ADD VALUE 'STORAGE_FEE';

-- AlterTable
ALTER TABLE "customer_profiles" ADD COLUMN     "returnAddressLine1" TEXT,
ADD COLUMN     "returnAddressLine2" TEXT,
ADD COLUMN     "returnCity" TEXT,
ADD COLUMN     "returnCountry" TEXT DEFAULT 'FR',
ADD COLUMN     "returnName" TEXT,
ADD COLUMN     "returnPhone" TEXT,
ADD COLUMN     "returnPostalCode" TEXT;

-- AlterTable
ALTER TABLE "files" ADD COLUMN     "marketplaceSaleId" TEXT;

-- AlterTable
ALTER TABLE "inventory_items" ADD COLUMN     "dropship" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "photosUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "storageOverdueSince" TIMESTAMP(3),
ADD COLUMN     "storagePaidUntil" TIMESTAMP(3),
ADD COLUMN     "storageReminderAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "outbound_shipments" ADD COLUMN     "dueAt" TIMESTAMP(3),
ADD COLUMN     "kind" "ShipmentKind" NOT NULL DEFAULT 'SALE',
ADD COLUMN     "lateAlertedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "supplier_orders" ADD COLUMN     "buyerAddressLine1" TEXT,
ADD COLUMN     "buyerAddressLine2" TEXT,
ADD COLUMN     "buyerCity" TEXT,
ADD COLUMN     "buyerCountry" TEXT,
ADD COLUMN     "buyerName" TEXT,
ADD COLUMN     "buyerPhone" TEXT,
ADD COLUMN     "buyerPostalCode" TEXT,
ADD COLUMN     "dropshipShipmentId" TEXT,
ADD COLUMN     "mode" "OrderMode" NOT NULL DEFAULT 'STOCK',
ADD COLUMN     "salePlatform" "MarketplacePlatform",
ADD COLUMN     "saleReference" TEXT,
ADD COLUMN     "storageCreditsCharged" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "storage_purchases" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "slots" INTEGER NOT NULL,
    "credits" INTEGER NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "supplierOrderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "storage_purchases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "extension_tokens" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "extension_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketplace_accounts" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "platform" "MarketplacePlatform" NOT NULL,
    "externalUserId" TEXT NOT NULL,
    "username" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketplace_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketplace_listings" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "platform" "MarketplacePlatform" NOT NULL,
    "externalId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT,
    "priceCents" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'eur',
    "photoUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "inventoryItemId" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketplace_listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketplace_sales" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "platform" "MarketplacePlatform" NOT NULL,
    "externalOrderId" TEXT NOT NULL,
    "listingId" TEXT,
    "title" TEXT NOT NULL,
    "priceCents" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'eur',
    "buyerName" TEXT,
    "soldAt" TIMESTAMP(3) NOT NULL,
    "status" "MarketplaceSaleStatus" NOT NULL DEFAULT 'NEW',
    "inventoryItemId" TEXT,
    "shipmentId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketplace_sales_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "storage_purchases_customerId_expiresAt_idx" ON "storage_purchases"("customerId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "extension_tokens_tokenHash_key" ON "extension_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "extension_tokens_customerId_idx" ON "extension_tokens"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "marketplace_accounts_customerId_platform_externalUserId_key" ON "marketplace_accounts"("customerId", "platform", "externalUserId");

-- CreateIndex
CREATE INDEX "marketplace_listings_inventoryItemId_idx" ON "marketplace_listings"("inventoryItemId");

-- CreateIndex
CREATE UNIQUE INDEX "marketplace_listings_customerId_platform_externalId_key" ON "marketplace_listings"("customerId", "platform", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "marketplace_sales_shipmentId_key" ON "marketplace_sales"("shipmentId");

-- CreateIndex
CREATE INDEX "marketplace_sales_customerId_status_idx" ON "marketplace_sales"("customerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "marketplace_sales_customerId_platform_externalOrderId_key" ON "marketplace_sales"("customerId", "platform", "externalOrderId");

-- CreateIndex
CREATE INDEX "files_marketplaceSaleId_idx" ON "files"("marketplaceSaleId");

-- CreateIndex
CREATE INDEX "inventory_items_storagePaidUntil_idx" ON "inventory_items"("storagePaidUntil");

-- CreateIndex
CREATE INDEX "outbound_shipments_dueAt_idx" ON "outbound_shipments"("dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_orders_dropshipShipmentId_key" ON "supplier_orders"("dropshipShipmentId");

-- AddForeignKey
ALTER TABLE "supplier_orders" ADD CONSTRAINT "supplier_orders_dropshipShipmentId_fkey" FOREIGN KEY ("dropshipShipmentId") REFERENCES "outbound_shipments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storage_purchases" ADD CONSTRAINT "storage_purchases_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_marketplaceSaleId_fkey" FOREIGN KEY ("marketplaceSaleId") REFERENCES "marketplace_sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extension_tokens" ADD CONSTRAINT "extension_tokens_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_accounts" ADD CONSTRAINT "marketplace_accounts_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_listings" ADD CONSTRAINT "marketplace_listings_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_listings" ADD CONSTRAINT "marketplace_listings_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "inventory_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_sales" ADD CONSTRAINT "marketplace_sales_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_sales" ADD CONSTRAINT "marketplace_sales_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "marketplace_listings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_sales" ADD CONSTRAINT "marketplace_sales_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "inventory_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_sales" ADD CONSTRAINT "marketplace_sales_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "outbound_shipments"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Intégrité
ALTER TABLE "storage_purchases"
  ADD CONSTRAINT "storage_purchases_amounts" CHECK ("slots" > 0 AND "credits" >= 0 AND "expiresAt" > "startsAt");
ALTER TABLE "supplier_orders"
  ADD CONSTRAINT "supplier_orders_storage_credits_non_negative" CHECK ("storageCreditsCharged" >= 0);

-- Règle des 2 semaines de stockage : les articles déjà en stock disposent de
-- 14 jours à compter de l'introduction de la règle.
UPDATE "inventory_items"
SET "storagePaidUntil" = NOW() + INTERVAL '14 days'
WHERE "storagePaidUntil" IS NULL;

-- Nouveaux tarifs (uniquement pour les offres encore aux valeurs par défaut :
-- une valeur modifiée dans le back-office n'est jamais écrasée).
UPDATE "plans" SET "priceCents" = 3900, "annualPriceCents" = 42900
  WHERE "code" = 'STARTER' AND "priceCents" = 2990 AND "monthlyCredits" = 20 AND ("annualPriceCents" IS NULL OR "annualPriceCents" = 29900);
UPDATE "plans" SET "priceCents" = 7900, "monthlyCredits" = 50, "annualPriceCents" = 86900
  WHERE "code" = 'PRO' AND "priceCents" = 6990 AND "monthlyCredits" = 55 AND ("annualPriceCents" IS NULL OR "annualPriceCents" = 69900);
UPDATE "plans" SET "priceCents" = 15900, "monthlyCredits" = 90, "annualPriceCents" = 174900
  WHERE "code" = 'BUSINESS' AND "priceCents" = 12990 AND "monthlyCredits" = 120 AND ("annualPriceCents" IS NULL OR "annualPriceCents" = 129900);

UPDATE "plans" SET "storageLimit" = 10 WHERE "code" = 'STARTER' AND "storageLimit" = 50;
UPDATE "plans" SET "storageLimit" = 25 WHERE "code" = 'PRO' AND "storageLimit" = 200;
UPDATE "plans" SET "storageLimit" = 60 WHERE "code" = 'BUSINESS' AND "storageLimit" = 600;

UPDATE "plans" SET "features" = ARRAY['20 crédits de préparation par mois', 'Préparateur de commandes attitré', '10 articles en stock en même temps', 'Colis expédiés sous 48 h', 'Suivi des commandes, du stock et des expéditions', 'Messagerie directe avec votre préparateur']
  WHERE "code" = 'STARTER' AND "features" = ARRAY['20 crédits de préparation par mois', 'Préparateur de commandes attitré', 'Stockage jusqu''à 50 articles', 'Suivi des commandes, du stock et des expéditions', 'Messagerie directe avec votre préparateur'];
UPDATE "plans" SET "features" = ARRAY['50 crédits de préparation par mois', 'Préparateur de commandes attitré', '25 articles en stock en même temps', 'Colis expédiés sous 48 h', 'Suivi des commandes, du stock et des expéditions', 'Messagerie directe avec votre préparateur']
  WHERE "code" = 'PRO' AND "features" = ARRAY['55 crédits de préparation par mois', 'Préparateur de commandes attitré', 'Stockage jusqu''à 200 articles', 'Suivi des commandes, du stock et des expéditions', 'Messagerie directe avec votre préparateur'];
UPDATE "plans" SET "features" = ARRAY['90 crédits de préparation par mois', 'Préparateur de commandes attitré', '60 articles en stock en même temps', 'Colis expédiés sous 48 h', 'Suivi des commandes, du stock et des expéditions', 'Messagerie directe avec votre préparateur']
  WHERE "code" = 'BUSINESS' AND "features" = ARRAY['120 crédits de préparation par mois', 'Préparateur de commandes attitré', 'Stockage jusqu''à 600 articles', 'Suivi des commandes, du stock et des expéditions', 'Messagerie directe avec votre préparateur'];

-- Recharges : nouveaux prix (si les prix par défaut n'ont pas été modifiés).
UPDATE "credit_packs" SET "priceCents" = 2490 WHERE "credits" = 10 AND "priceCents" = 1990;
UPDATE "credit_packs" SET "priceCents" = 6990 WHERE "credits" = 30 AND "priceCents" = 5490;
UPDATE "credit_packs" SET "priceCents" = 10990 WHERE "credits" = 50 AND "priceCents" = 8490;
UPDATE "credit_packs" SET "priceCents" = 19900 WHERE "credits" = 100 AND "priceCents" = 15990;
