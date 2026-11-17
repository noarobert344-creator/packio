-- Commandes du Japon (ZenMarket) : les préparateurs acceptent de recevoir à leur
-- adresse ; elle n'est proposée que pour ZenMarket. Les autres fournisseurs
-- passent par les points relais, lockers et la poste restante.
UPDATE "suppliers"
SET "acceptedLocationTypes" = array_remove("acceptedLocationTypes", 'BUSINESS_ADDRESS'::"LocationType"), "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" <> 'ZENMARKET' AND 'BUSINESS_ADDRESS'::"LocationType" = ANY("acceptedLocationTypes");

-- Supplément « livraison à une adresse » retiré (remis à 0).
UPDATE "app_settings"
SET "value" = jsonb_set("value"::jsonb, '{addressDeliveryCredits}', '0'::jsonb), "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" = 'shipping' AND ("value"::jsonb) ? 'addressDeliveryCredits';

UPDATE "suppliers" SET "compatibilityNotes" = 'Au paiement, choisissez « Point Relais » si Temu le propose pour vos articles : livré à un point relais ou une consigne de votre préparateur. Sinon, livraison à domicile en poste restante. Les délais varient : tenez-en compte dans le délai annoncé à votre acheteur.', "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" = 'TEMU' AND "compatibilityNotes" = 'Au paiement, choisissez « Point Relais » si Temu le propose pour vos articles : livré à un point relais ou une consigne de votre préparateur, sans supplément. Sinon, livraison à domicile en poste restante (supplément en crédits). Les délais varient : tenez-en compte dans le délai annoncé à votre acheteur.';

UPDATE "suppliers" SET "compatibilityNotes" = 'Au paiement, choisissez la livraison en point relais (Mondial Relay). Si elle n''est pas proposée, livraison à domicile en poste restante.', "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" = 'SHEIN' AND "compatibilityNotes" = 'Au paiement, choisissez la livraison en point relais (Mondial Relay) : sans supplément. Si elle n''est pas proposée, livraison à domicile en poste restante (supplément en crédits).';

UPDATE "suppliers" SET "compatibilityNotes" = 'Au paiement, choisissez un point de retrait (Relais Colis, relais ou consigne Pickup, locker InPost) s''il est proposé. Sinon, livraison à domicile en poste restante. Les options varient selon le vendeur et votre zone.', "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" = 'ALIEXPRESS' AND "compatibilityNotes" = 'Au paiement, choisissez un point de retrait (Relais Colis, relais ou consigne Pickup, locker InPost) s''il est proposé : sans supplément. Sinon, livraison à domicile en poste restante (supplément en crédits). Les options varient selon le vendeur et votre zone.';
