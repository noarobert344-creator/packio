-- AlterTable
ALTER TABLE "preparer_locations" ADD COLUMN     "recipientPhone" TEXT;


-- Par défaut, le numéro du préparateur (modifiable par point de réception).
UPDATE "preparer_locations" l SET "recipientPhone" = u."phone"
FROM "preparer_profiles" p JOIN "users" u ON u."id" = p."userId"
WHERE l."preparerId" = p."id" AND l."recipientPhone" IS NULL AND u."phone" IS NOT NULL;

-- Vinted : le numéro du préparateur doit être indiqué à la commande.
UPDATE "suppliers" SET "compatibilityNotes" = 'Les modes de livraison proposés dépendent du vendeur et du pays. Choisissez au paiement le point relais ou le locker de votre préparateur, avec le nom de destinataire et le numéro de téléphone indiqués : votre préparateur reçoit ainsi le SMS avec le code de retrait.'
WHERE "code" = 'VINTED' AND "compatibilityNotes" = 'Les modes de livraison proposés dépendent du vendeur et du pays. Choisissez au paiement le point relais ou le locker de votre préparateur, avec le nom de destinataire indiqué. Transmettez ensuite le code de retrait reçu.';
