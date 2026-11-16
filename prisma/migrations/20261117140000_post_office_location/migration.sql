-- Nouveau type de point de réception : poste restante (bureau de poste).
ALTER TYPE "LocationType" ADD VALUE IF NOT EXISTS 'POST_OFFICE';
