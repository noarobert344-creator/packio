-- Lieu d'arrivée indiqué par le client ; « Autre fournisseur » proposé pour le stock et le dropshipping.
-- AlterTable
ALTER TABLE "supplier_orders" ADD COLUMN     "arrivalNote" TEXT,
ADD COLUMN     "arrivalOther" BOOLEAN NOT NULL DEFAULT false;

-- « Autre » : le client précise où il a acheté l'article (seulement si encore désactivé par défaut).
UPDATE "suppliers" SET "orderModes" = ARRAY['STOCK', 'DROPSHIP']::"OrderMode"[] WHERE "code" = 'OTHER' AND cardinality("orderModes") = 0;

-- Whatnot (achats en direct) pour les commandes vers le stock ; Temu passe après Whatnot dans la liste.
INSERT INTO "suppliers" ("id", "code", "name", "websiteUrl", "acceptedLocationTypes", "acceptedNetworks", "requiresPickupCode", "compatibilityNotes", "orderModes", "isActive", "sortOrder", "updatedAt")
SELECT 'sup_whatnot', 'WHATNOT', 'Whatnot', 'https://www.whatnot.com/fr-FR', ARRAY['BUSINESS_ADDRESS', 'LOCKER', 'RELAY_POINT']::"LocationType"[], ARRAY['MONDIAL_RELAY', 'INPOST', 'RELAIS_COLIS', 'CHRONOPOST_PICKUP', 'LA_POSTE', 'OTHER'], false,
  'Achats en direct (enchères et ventes en live). Les modes de livraison dépendent du vendeur : indiquez au paiement l''adresse ou le point de retrait de votre préparateur, avec le nom de destinataire et votre code client.',
  ARRAY['STOCK']::"OrderMode"[], true, 4, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "suppliers" WHERE "code" = 'WHATNOT');
UPDATE "suppliers" SET "sortOrder" = 7 WHERE "code" = 'ALIEXPRESS' AND "sortOrder" = 6;
UPDATE "suppliers" SET "sortOrder" = 6 WHERE "code" = 'SHEIN' AND "sortOrder" = 5;
UPDATE "suppliers" SET "sortOrder" = 5 WHERE "code" = 'TEMU' AND "sortOrder" = 4;
