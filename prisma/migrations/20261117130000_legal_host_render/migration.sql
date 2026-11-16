-- Hébergeur réel du site : Render (et non Vercel, ancienne valeur par défaut).
-- Ne modifie les informations légales que si elles ont encore l'ancienne valeur par défaut.
UPDATE "app_settings"
SET "value" = jsonb_set(
      jsonb_set("value", '{hostName}', '"Render Services, Inc."'::jsonb),
      '{hostAddress}', '"525 Brannan Street, Suite 300, San Francisco, CA 94107, États-Unis"'::jsonb
    ),
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" = 'legal'
  AND ("value" ->> 'hostName') = 'Vercel Inc.'
  AND ("value" ->> 'hostAddress') = '440 N Barranca Ave #4133, Covina, CA 91723, États-Unis';
