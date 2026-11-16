-- Recharges : 10 crédits 29,90 €, 30 crédits 84,90 €, 50 crédits 134,90 €,
-- 100 crédits 249 € (au moins le prix d'un crédit inclus dans l'offre Starter).
-- Seules les recharges encore aux prix par défaut précédents, et sans plan Whop
-- associé (prix figé chez Whop), sont modifiées.
UPDATE "credit_packs" SET "priceCents" = 2990 WHERE "credits" = 10 AND "priceCents" = 2490 AND "whopPlanId" IS NULL;
UPDATE "credit_packs" SET "priceCents" = 8490 WHERE "credits" = 30 AND "priceCents" = 6990 AND "whopPlanId" IS NULL;
UPDATE "credit_packs" SET "priceCents" = 13490 WHERE "credits" = 50 AND "priceCents" = 10990 AND "whopPlanId" IS NULL;
UPDATE "credit_packs" SET "priceCents" = 24900 WHERE "credits" = 100 AND "priceCents" = 19900 AND "whopPlanId" IS NULL;
