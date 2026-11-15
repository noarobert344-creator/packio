import { z } from "zod";
import { db, type DbClient } from "@/server/db";

/** Paramètres configurables par l'administrateur (valeurs par défaut ci-dessous). */
export const SETTINGS_SCHEMAS = {
  assignment: z.object({
    slaHours: z.number().int().min(1).max(168),
  }),
  credits: z.object({
    monthly: z.object({
      /** EXPIRE : les crédits mensuels non utilisés expirent au renouvellement.
       *  ROLLOVER : ils sont reportés pendant `rolloverMonths` mois, plafonnés. */
      mode: z.enum(["EXPIRE", "ROLLOVER"]),
      rolloverMonths: z.number().int().min(1).max(12),
      /** Plafond du report, en % de l'allocation mensuelle de l'offre. */
      rolloverCapPercent: z.number().int().min(0).max(1000),
    }),
    purchased: z.object({
      mode: z.enum(["NEVER", "EXPIRE_AFTER_DAYS"]),
      days: z.number().int().min(1).max(3650),
    }),
  }),
  notifications: z.object({
    /** Adresses e-mail supplémentaires recevant les alertes administrateur. */
    adminEmails: z.array(z.email()).max(10),
  }),
  support: z.object({
    email: z.email(),
    phone: z.string().max(40),
    hours: z.string().max(120),
  }),
  legal: z.object({
    companyName: z.string().max(120),
    legalForm: z.string().max(60),
    capital: z.string().max(60),
    address: z.string().max(240),
    siret: z.string().max(40),
    rcs: z.string().max(80),
    vatNumber: z.string().max(40),
    publicationDirector: z.string().max(120),
    contactEmail: z.string().max(120),
    hostName: z.string().max(120),
    hostAddress: z.string().max(240),
    dpoEmail: z.string().max(120),
  }),
  messaging: z.object({
    supervisionMinutes: z.number().int().min(5).max(24 * 60),
  }),
} as const;

export type SettingKey = keyof typeof SETTINGS_SCHEMAS;
export type Settings = { [K in SettingKey]: z.infer<(typeof SETTINGS_SCHEMAS)[K]> };

export const SETTINGS_DEFAULTS: Settings = {
  assignment: { slaHours: 24 },
  credits: {
    monthly: { mode: "EXPIRE", rolloverMonths: 1, rolloverCapPercent: 100 },
    purchased: { mode: "NEVER", days: 365 },
  },
  notifications: { adminEmails: [] },
  support: { email: "support@packio.fr", phone: "", hours: "Du lundi au vendredi, de 9 h à 18 h" },
  legal: {
    companyName: "",
    legalForm: "",
    capital: "",
    address: "",
    siret: "",
    rcs: "",
    vatNumber: "",
    publicationDirector: "",
    contactEmail: "",
    hostName: "Vercel Inc.",
    hostAddress: "440 N Barranca Ave #4133, Covina, CA 91723, États-Unis",
    dpoEmail: "",
  },
  messaging: { supervisionMinutes: 60 },
};

export async function getSetting<K extends SettingKey>(key: K, client: DbClient = db): Promise<Settings[K]> {
  const row = await client.appSetting.findUnique({ where: { key } });
  if (!row) return SETTINGS_DEFAULTS[key];
  const merged = deepMerge(SETTINGS_DEFAULTS[key], row.value);
  const parsed = SETTINGS_SCHEMAS[key].safeParse(merged);
  return (parsed.success ? parsed.data : SETTINGS_DEFAULTS[key]) as Settings[K];
}

export async function getAllSettings(client: DbClient = db): Promise<Settings> {
  const rows = await client.appSetting.findMany();
  const out = { ...SETTINGS_DEFAULTS } as Record<string, unknown>;
  for (const key of Object.keys(SETTINGS_SCHEMAS) as SettingKey[]) {
    const row = rows.find((r) => r.key === key);
    if (!row) continue;
    const parsed = SETTINGS_SCHEMAS[key].safeParse(deepMerge(SETTINGS_DEFAULTS[key], row.value));
    if (parsed.success) out[key] = parsed.data;
  }
  return out as Settings;
}

export async function saveSetting<K extends SettingKey>(key: K, value: Settings[K], updatedById: string | null, client: DbClient = db) {
  const parsed = SETTINGS_SCHEMAS[key].parse(value);
  await client.appSetting.upsert({
    where: { key },
    create: { key, value: parsed as object, updatedById },
    update: { value: parsed as object, updatedById },
  });
  return parsed as Settings[K];
}

function deepMerge<T>(base: T, override: unknown): T {
  if (typeof base !== "object" || base === null || Array.isArray(base)) return (override ?? base) as T;
  if (typeof override !== "object" || override === null || Array.isArray(override)) return base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(override as Record<string, unknown>)) {
    out[k] = k in out ? deepMerge(out[k], v) : v;
  }
  return out as T;
}
