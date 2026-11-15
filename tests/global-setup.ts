import { execSync } from "node:child_process";

/** Applique les migrations sur la base de test avant l'exécution des suites. */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgresql://packio:packio@localhost:5432/packio_test?schema=public";
  execSync("npx prisma migrate deploy", { stdio: "inherit", env: { ...process.env, DATABASE_URL: url, DIRECT_DATABASE_URL: url } });
}
