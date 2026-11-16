-- Questionnaire de bienvenue du préparateur et mode préparateur d'un administrateur.
-- AlterTable
ALTER TABLE "preparer_profiles" ADD COLUMN     "onboardedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "activeRole" "UserRole";


-- Les préparateurs existants sont considérés comme ayant déjà renseigné leur fiche.
UPDATE "preparer_profiles" SET "onboardedAt" = "createdAt" WHERE "onboardedAt" IS NULL;
