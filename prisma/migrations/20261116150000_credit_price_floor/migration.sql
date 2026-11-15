-- Prix minimum de 1,90 € par crédit en mensuel : Pro 95 € (50 crédits) et
-- Business 171 € (90 crédits), formule annuelle à 11 mois (1 mois offert).
-- Seules les offres encore aux valeurs par défaut précédentes sont modifiées.
UPDATE "plans" SET "priceCents" = 9500, "annualPriceCents" = 104500
  WHERE "code" = 'PRO' AND "priceCents" = 7900 AND "monthlyCredits" = 50 AND ("annualPriceCents" IS NULL OR "annualPriceCents" = 86900);
UPDATE "plans" SET "priceCents" = 17100, "annualPriceCents" = 188100
  WHERE "code" = 'BUSINESS' AND "priceCents" = 15900 AND "monthlyCredits" = 90 AND ("annualPriceCents" IS NULL OR "annualPriceCents" = 174900);
