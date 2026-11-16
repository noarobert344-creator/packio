import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/cron/[task]/route";
import { resetDb } from "../helpers";

const call = (task: string, auth?: string) =>
  GET(new Request(`http://localhost/api/cron/${task}`, { headers: auth ? { authorization: auth } : {} }), {
    params: Promise.resolve({ task }),
  } as Parameters<typeof GET>[1]);

describe("Tâches planifiées (ordonnanceur externe gratuit)", () => {
  beforeEach(async () => {
    await resetDb();
    vi.stubEnv("CRON_SECRET", "secret-de-test-cron");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("refuse sans le bon secret ; « toutes » enchaîne délais et crédits, ménage seulement entre 3 h 30 et 3 h 45 UTC", async () => {
    expect((await call("toutes")).status).toBe(401);
    expect((await call("toutes", "Bearer mauvais-secret-de-test")).status).toBe(401);

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-16T10:00:00Z"));
    const day = await call("toutes", "Bearer secret-de-test-cron");
    expect(day.status).toBe(200);
    const body = await day.json();
    expect(body).toHaveProperty("attribution.assignments");
    expect(body).toHaveProperty("credits.expired");
    expect(body.maintenance).toBeNull();

    vi.setSystemTime(new Date("2026-11-16T03:31:00Z"));
    const night = await (await call("toutes", "Bearer secret-de-test-cron")).json();
    expect(night.maintenance).toMatchObject({ sessions: 0, loginAttempts: 0, tokens: 0 });

    expect((await call("inconnue", "Bearer secret-de-test-cron")).status).toBe(404);
  });
});
