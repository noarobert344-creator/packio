-- Places de stock supplémentaires : 1 crédit = 1 place (au lieu de 3).
-- Ne modifie le réglage que s'il a encore l'ancienne valeur par défaut.
UPDATE "app_settings"
SET "value" = jsonb_set("value", '{slotsPerCredit}', '1'::jsonb), "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" = 'storage' AND ("value" ->> 'slotsPerCredit') = '3';
