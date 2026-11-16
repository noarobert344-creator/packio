-- Offres : Starter 49 € (20 crédits), Pro 95 € (40 crédits), Business 179 €
-- (80 crédits) ; formule annuelle à 11 mois (1 mois offert).
-- Seules les offres encore aux valeurs par défaut précédentes sont modifiées.
UPDATE "plans" SET "priceCents" = 4900, "annualPriceCents" = 53900
  WHERE "code" = 'STARTER' AND "priceCents" = 3900 AND "monthlyCredits" = 20 AND ("annualPriceCents" IS NULL OR "annualPriceCents" = 42900);
UPDATE "plans" SET "monthlyCredits" = 40,
  "features" = array_replace("features", '50 crédits de préparation par mois', '40 crédits de préparation par mois')
  WHERE "code" = 'PRO' AND "priceCents" = 9500 AND "monthlyCredits" = 50;
UPDATE "plans" SET "priceCents" = 17900, "monthlyCredits" = 80, "annualPriceCents" = 196900,
  "features" = array_replace("features", '90 crédits de préparation par mois', '80 crédits de préparation par mois')
  WHERE "code" = 'BUSINESS' AND "priceCents" = 17100 AND "monthlyCredits" = 90 AND ("annualPriceCents" IS NULL OR "annualPriceCents" = 188100);
