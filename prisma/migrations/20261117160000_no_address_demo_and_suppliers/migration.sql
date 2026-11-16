-- Plus aucune adresse : jamais de livraison au domicile d'un préparateur.

-- 1. Données de démonstration uniquement (comptes @demo.packio.local) :
--    les adresses deviennent des postes restantes, et l'adresse personnelle est effacée.
UPDATE "preparer_locations" AS pl
SET "type" = 'POST_OFFICE',
    "label" = 'Poste restante',
    "network" = 'LA_POSTE',
    "relayName" = 'Bureau de poste ' || pl."city" || ' Centre (démo)',
    "addressLine1" = 'Place de la Poste (démo)',
    "addressLine2" = NULL,
    "instructions" = NULL,
    "updatedAt" = CURRENT_TIMESTAMP
FROM "preparer_profiles" AS pp
JOIN "users" AS u ON u."id" = pp."userId"
WHERE pl."preparerId" = pp."id"
  AND pl."type" = 'BUSINESS_ADDRESS'
  AND u."isDemo" = true
  AND u."email" LIKE '%@demo.packio.local';

UPDATE "preparer_profiles" AS pp
SET "businessAddressLine1" = NULL,
    "businessAddressLine2" = NULL,
    "businessPostalCode" = NULL,
    "businessCity" = NULL,
    "updatedAt" = CURRENT_TIMESTAMP
FROM "users" AS u
WHERE u."id" = pp."userId"
  AND u."isDemo" = true
  AND u."email" LIKE '%@demo.packio.local';

-- 2. Vestiaire Collective, Temu et AliExpress : poste restante possible (si livré par La Poste / Colissimo).
--    Seulement si le réglage a encore sa valeur par défaut.
UPDATE "suppliers"
SET "acceptedLocationTypes" = ARRAY['POST_OFFICE', 'BUSINESS_ADDRESS']::"LocationType"[],
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" IN ('VESTIAIRE', 'TEMU', 'ALIEXPRESS')
  AND "acceptedLocationTypes" = ARRAY['BUSINESS_ADDRESS']::"LocationType"[];

UPDATE "suppliers"
SET "compatibilityNotes" = 'Livraison en poste restante au bureau de poste de votre préparateur : choisissez une livraison par La Poste (Colissimo) si le site le propose. Les options de point relais varient selon la commande : vérifiez-les au paiement.',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" = 'VESTIAIRE' AND "compatibilityNotes" = 'Livraison à l''adresse de domiciliation de votre préparateur (nom du destinataire et code client indiqués dans votre espace). Les options de point relais varient selon la commande : vérifiez-les au paiement.';

UPDATE "suppliers"
SET "compatibilityNotes" = 'Livraison en poste restante au bureau de poste de votre préparateur (colis remis à La Poste / Colissimo). Les délais de livraison varient : tenez-en compte dans le délai annoncé à votre acheteur.',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" = 'TEMU' AND "compatibilityNotes" = 'Livraison à l''adresse de domiciliation de votre préparateur. Les délais de livraison varient : tenez-en compte dans le délai annoncé à votre acheteur.';

UPDATE "suppliers"
SET "compatibilityNotes" = 'Livraison en poste restante au bureau de poste de votre préparateur (colis remis à La Poste / Colissimo). Les options de retrait varient selon le vendeur.',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" = 'ALIEXPRESS' AND "compatibilityNotes" = 'Livraison à l''adresse de domiciliation du préparateur recommandée. Les options de retrait varient selon le vendeur et ne sont pas activées par défaut.';
