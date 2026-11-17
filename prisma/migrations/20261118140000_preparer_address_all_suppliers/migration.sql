-- Adresse du préparateur : proposée pour tous les fournisseurs (fournisseurs
-- privés, « Autre »…) et plus seulement ZenMarket ; les points relais et
-- lockers restent proposés en premier dans le formulaire de commande.
UPDATE "suppliers"
SET "acceptedLocationTypes" = array_append("acceptedLocationTypes", 'BUSINESS_ADDRESS'::"LocationType"), "updatedAt" = CURRENT_TIMESTAMP
WHERE NOT ('BUSINESS_ADDRESS'::"LocationType" = ANY("acceptedLocationTypes"));
