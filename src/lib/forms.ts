import { z } from "zod";

/** Champ texte de formulaire : espaces retirés, chaîne vide → undefined. */
export const optionalText = (max = 500) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : typeof v === "string" ? v.trim() : v), z.string().max(max).optional());

export const requiredText = (label: string, min = 1, max = 500) =>
  z.preprocess(
    (v) => (typeof v === "string" ? v.trim() : v),
    z
      .string({ error: `${label} requis` })
      .min(min, { error: min > 1 ? `${label} : ${min} caractères minimum` : `${label} requis` })
      .max(max, { error: `${label} : ${max} caractères maximum` }),
  );

export const intField = (label: string, opts?: { min?: number; max?: number }) =>
  z.preprocess(
    (v) => (v === "" || v === undefined || v === null ? undefined : Number(v)),
    z
      .number({ error: `${label} invalide` })
      .int({ error: `${label} : nombre entier attendu` })
      .min(opts?.min ?? Number.MIN_SAFE_INTEGER, { error: `${label} : minimum ${opts?.min}` })
      .max(opts?.max ?? Number.MAX_SAFE_INTEGER, { error: `${label} : maximum ${opts?.max}` }),
  );

export const optionalInt = (label: string, opts?: { min?: number; max?: number }) =>
  z.preprocess(
    (v) => (v === "" || v === undefined || v === null ? undefined : Number(v)),
    z
      .number({ error: `${label} invalide` })
      .int()
      .min(opts?.min ?? Number.MIN_SAFE_INTEGER)
      .max(opts?.max ?? Number.MAX_SAFE_INTEGER)
      .optional(),
  );

/** Montant en euros saisi ("29,90") → centimes. */
export const euroToCents = (label: string) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() !== "" ? Math.round(Number(v.replace(",", ".").replace(/\s/g, "")) * 100) : undefined),
    z.number({ error: `${label} invalide` }).int().min(0, { error: `${label} invalide` }),
  );

/** Montant facultatif en euros (vide → null). */
export const optionalEuroToCents = (label: string) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() !== "" ? Math.round(Number(v.replace(",", ".").replace(/\s/g, "")) * 100) : null),
    z.number({ error: `${label} invalide` }).int().min(1, { error: `${label} invalide` }).nullable(),
  );

export const checkbox = () => z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean());

export const dateField = (label: string) =>
  z.preprocess((v) => (typeof v === "string" && v ? new Date(v) : undefined), z.date({ error: `${label} invalide` }));

export const optionalDate = () =>
  z.preprocess((v) => (typeof v === "string" && v ? new Date(v) : undefined), z.date().optional());

export const stringArray = () => z.preprocess((v) => (Array.isArray(v) ? v : typeof v === "string" && v ? [v] : []), z.array(z.string().max(200)));

export const emailField = () =>
  z.preprocess((v) => (typeof v === "string" ? v.trim().toLowerCase() : v), z.email({ error: "Adresse e-mail invalide" }));

export const phoneField = () =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().regex(/^\+?[0-9 ().-]{6,20}$/, { error: "Numéro de téléphone invalide" }).optional(),
  );
