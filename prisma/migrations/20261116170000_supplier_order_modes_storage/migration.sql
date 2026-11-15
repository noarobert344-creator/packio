-- AlterTable
ALTER TABLE "suppliers" ADD COLUMN     "orderModes" "OrderMode"[] DEFAULT ARRAY['STOCK', 'DROPSHIP']::"OrderMode"[];


-- Fournisseurs proposés par type de commande :
--  - commande pour le stock : ZenMarket, Vinted, Vestiaire Collective ;
--  - dropshipping : Temu, SHEIN, AliExpress.
UPDATE "suppliers" SET "orderModes" = ARRAY['STOCK']::"OrderMode"[] WHERE "code" IN ('ZENMARKET', 'VINTED', 'VESTIAIRE');
UPDATE "suppliers" SET "orderModes" = ARRAY['DROPSHIP']::"OrderMode"[] WHERE "code" IN ('SHEIN', 'ALIEXPRESS', 'TEMU');
UPDATE "suppliers" SET "orderModes" = ARRAY[]::"OrderMode"[] WHERE "code" = 'OTHER';

INSERT INTO "suppliers" ("id", "code", "name", "websiteUrl", "acceptedLocationTypes", "acceptedNetworks", "requiresPickupCode", "compatibilityNotes", "orderModes", "isActive", "sortOrder", "updatedAt")
VALUES
  ('supplier_vestiaire', 'VESTIAIRE', 'Vestiaire Collective', 'https://fr.vestiairecollective.com', ARRAY['BUSINESS_ADDRESS']::"LocationType"[], ARRAY[]::TEXT[], false,
   'Livraison à l''adresse professionnelle de votre préparateur (nom du destinataire et code client indiqués dans votre espace). Les options de point relais varient selon la commande : vérifiez-les au paiement.',
   ARRAY['STOCK']::"OrderMode"[], true, 3, NOW()),
  ('supplier_temu', 'TEMU', 'Temu', 'https://www.temu.com/fr', ARRAY['BUSINESS_ADDRESS']::"LocationType"[], ARRAY[]::TEXT[], false,
   'Livraison à l''adresse professionnelle de votre préparateur. Les délais de livraison varient : tenez-en compte dans le délai annoncé à votre acheteur.',
   ARRAY['DROPSHIP']::"OrderMode"[], true, 4, NOW())
ON CONFLICT ("code") DO NOTHING;

-- Places de stock incluses : 5 / 10 / 20 (offres encore aux valeurs par défaut).
UPDATE "plans" SET "storageLimit" = 5 WHERE "code" = 'STARTER' AND "storageLimit" = 10;
UPDATE "plans" SET "storageLimit" = 10 WHERE "code" = 'PRO' AND "storageLimit" = 25;
UPDATE "plans" SET "storageLimit" = 20 WHERE "code" = 'BUSINESS' AND "storageLimit" = 60;
UPDATE "plans" SET "features" = array_replace("features", '10 articles en stock en même temps', '5 articles en stock en même temps') WHERE "code" = 'STARTER';
UPDATE "plans" SET "features" = array_replace("features", '25 articles en stock en même temps', '10 articles en stock en même temps') WHERE "code" = 'PRO';
UPDATE "plans" SET "features" = array_replace("features", '60 articles en stock en même temps', '20 articles en stock en même temps') WHERE "code" = 'BUSINESS';

-- Ordre d'affichage : ZenMarket, Vinted, Vestiaire Collective ; Temu, SHEIN, AliExpress.
UPDATE "suppliers" SET "sortOrder" = 1 WHERE "code" = 'ZENMARKET';
UPDATE "suppliers" SET "sortOrder" = 2 WHERE "code" = 'VINTED';
UPDATE "suppliers" SET "sortOrder" = 3 WHERE "code" = 'VESTIAIRE';
UPDATE "suppliers" SET "sortOrder" = 4 WHERE "code" = 'TEMU';
UPDATE "suppliers" SET "sortOrder" = 5 WHERE "code" = 'SHEIN';
UPDATE "suppliers" SET "sortOrder" = 6 WHERE "code" = 'ALIEXPRESS';
