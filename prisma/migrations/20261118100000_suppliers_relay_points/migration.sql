-- Temu, SHEIN et AliExpress proposent souvent le point relais en France : les
-- commandes peuvent arriver en point relais ou en consigne (sans supplément),
-- la poste restante restant possible à défaut. Seules les valeurs encore égales
-- aux réglages par défaut précédents sont modifiées (réglages de l'administrateur préservés).

UPDATE "suppliers"
SET "acceptedLocationTypes" = ARRAY['RELAY_POINT', 'LOCKER', 'POST_OFFICE', 'BUSINESS_ADDRESS']::"LocationType"[],
    "acceptedNetworks" = ARRAY['MONDIAL_RELAY', 'CHRONOPOST_PICKUP', 'LA_POSTE'],
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" = 'TEMU' AND "acceptedLocationTypes" = ARRAY['POST_OFFICE', 'BUSINESS_ADDRESS']::"LocationType"[] AND "acceptedNetworks" = ARRAY[]::TEXT[];

UPDATE "suppliers"
SET "acceptedLocationTypes" = ARRAY['RELAY_POINT', 'LOCKER', 'POST_OFFICE', 'BUSINESS_ADDRESS']::"LocationType"[],
    "acceptedNetworks" = ARRAY['RELAIS_COLIS', 'CHRONOPOST_PICKUP', 'LA_POSTE', 'INPOST'],
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" = 'ALIEXPRESS' AND "acceptedLocationTypes" = ARRAY['POST_OFFICE', 'BUSINESS_ADDRESS']::"LocationType"[] AND "acceptedNetworks" = ARRAY[]::TEXT[];

UPDATE "suppliers"
SET "acceptedLocationTypes" = ARRAY['RELAY_POINT', 'POST_OFFICE', 'BUSINESS_ADDRESS']::"LocationType"[],
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" = 'SHEIN' AND "acceptedLocationTypes" = ARRAY['BUSINESS_ADDRESS', 'RELAY_POINT']::"LocationType"[];

UPDATE "suppliers" SET "compatibilityNotes" = 'Au paiement, choisissez « Point Relais » si Temu le propose pour vos articles : livré à un point relais ou une consigne de votre préparateur, sans supplément. Sinon, livraison à domicile en poste restante (supplément en crédits). Les délais varient : tenez-en compte dans le délai annoncé à votre acheteur.', "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" = 'TEMU' AND "compatibilityNotes" = 'Livraison en poste restante au bureau de poste de votre préparateur (colis remis à La Poste / Colissimo). Les délais de livraison varient : tenez-en compte dans le délai annoncé à votre acheteur.';

UPDATE "suppliers" SET "compatibilityNotes" = 'Au paiement, choisissez la livraison en point relais (Mondial Relay) : sans supplément. Si elle n''est pas proposée, livraison à domicile en poste restante (supplément en crédits).', "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" = 'SHEIN' AND "compatibilityNotes" = 'La livraison en point relais n''est pas proposée pour toutes les commandes : vérifiez l''option au moment du paiement.';

UPDATE "suppliers" SET "compatibilityNotes" = 'Au paiement, choisissez un point de retrait (Relais Colis, relais ou consigne Pickup, locker InPost) s''il est proposé : sans supplément. Sinon, livraison à domicile en poste restante (supplément en crédits). Les options varient selon le vendeur et votre zone.', "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" = 'ALIEXPRESS' AND "compatibilityNotes" = 'Livraison en poste restante au bureau de poste de votre préparateur (colis remis à La Poste / Colissimo). Les options de retrait varient selon le vendeur.';
