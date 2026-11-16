-- Livraison sans jamais passer par le domicile du préparateur : poste restante.
-- Chaque mise à jour ne s'applique que si le réglage a encore sa valeur par défaut.

-- ZenMarket : poste restante (poste japonaise remise à La Poste) ou adresse de domiciliation.
UPDATE "suppliers"
SET "acceptedLocationTypes" = ARRAY['POST_OFFICE', 'BUSINESS_ADDRESS']::"LocationType"[],
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" = 'ZENMARKET' AND "acceptedLocationTypes" = ARRAY['BUSINESS_ADDRESS']::"LocationType"[];

UPDATE "suppliers"
SET "compatibilityNotes" = 'Choisissez un envoi par la poste japonaise (EMS, ePacket ou courrier aérien) : il est livré en France par La Poste, en poste restante au bureau de poste de votre préparateur, avec le nom du destinataire indiqué. DHL et FedEx ne livrent pas en poste restante : dans ce cas, utilisez uniquement une adresse de domiciliation.',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" = 'ZENMARKET' AND "compatibilityNotes" = 'Expédition internationale vers une adresse complète avec numéro de téléphone : les lockers et points relais ne sont pas utilisables.';

-- Whatnot et « Autre » : poste restante en plus des autres points.
UPDATE "suppliers"
SET "acceptedLocationTypes" = array_append("acceptedLocationTypes", 'POST_OFFICE'::"LocationType"),
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" IN ('WHATNOT', 'OTHER')
  AND "acceptedLocationTypes" @> ARRAY['BUSINESS_ADDRESS', 'LOCKER', 'RELAY_POINT']::"LocationType"[]
  AND "acceptedLocationTypes" <@ ARRAY['BUSINESS_ADDRESS', 'LOCKER', 'RELAY_POINT']::"LocationType"[];

-- « Adresse professionnelle » devient « adresse de domiciliation » (jamais le domicile).
UPDATE "suppliers"
SET "compatibilityNotes" = 'Livraison à l''adresse de domiciliation de votre préparateur (nom du destinataire et code client indiqués dans votre espace). Les options de point relais varient selon la commande : vérifiez-les au paiement.',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" = 'VESTIAIRE' AND "compatibilityNotes" = 'Livraison à l''adresse professionnelle de votre préparateur (nom du destinataire et code client indiqués dans votre espace). Les options de point relais varient selon la commande : vérifiez-les au paiement.';

UPDATE "suppliers"
SET "compatibilityNotes" = 'Livraison à l''adresse de domiciliation de votre préparateur. Les délais de livraison varient : tenez-en compte dans le délai annoncé à votre acheteur.',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" = 'TEMU' AND "compatibilityNotes" = 'Livraison à l''adresse professionnelle de votre préparateur. Les délais de livraison varient : tenez-en compte dans le délai annoncé à votre acheteur.';

UPDATE "suppliers"
SET "compatibilityNotes" = 'Livraison à l''adresse de domiciliation du préparateur recommandée. Les options de retrait varient selon le vendeur et ne sont pas activées par défaut.',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" = 'ALIEXPRESS' AND "compatibilityNotes" = 'Livraison à l''adresse professionnelle du préparateur recommandée. Les options de retrait varient selon le vendeur et ne sont pas activées par défaut.';
