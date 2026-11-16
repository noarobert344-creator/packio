-- Vente « Vendu en dropshipping » : lien vers la commande fournisseur passée pour la vente.
-- AlterEnum
ALTER TYPE "MarketplaceSaleStatus" ADD VALUE 'DROPSHIP';

-- AlterTable
ALTER TABLE "marketplace_sales" ADD COLUMN     "dropshipOrderId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "marketplace_sales_dropshipOrderId_key" ON "marketplace_sales"("dropshipOrderId");

-- AddForeignKey
ALTER TABLE "marketplace_sales" ADD CONSTRAINT "marketplace_sales_dropshipOrderId_fkey" FOREIGN KEY ("dropshipOrderId") REFERENCES "supplier_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

