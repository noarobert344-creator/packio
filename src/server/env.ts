import "server-only";

/**
 * Configuration serveur. Les secrets ne sont jamais exposés au navigateur :
 * seules les variables préfixées NEXT_PUBLIC_ le sont, et Packio n'en utilise
 * aucune contenant de secret.
 */
function bool(v: string | undefined, fallback = false) {
  if (v === undefined || v === "") return fallback;
  return v === "1" || v.toLowerCase() === "true";
}

export const env = {
  get nodeEnv() {
    return process.env.NODE_ENV ?? "development";
  },
  get isProduction() {
    return process.env.NODE_ENV === "production";
  },
  get appUrl() {
    return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  },
  /** "whop" (défaut) ou "dev" (paiements simulés, interdit en production). */
  get billingMode(): "whop" | "dev" {
    const mode = process.env.BILLING_MODE === "dev" ? "dev" : "whop";
    if (mode === "dev" && process.env.NODE_ENV === "production" && !bool(process.env.ALLOW_DEV_BILLING_IN_PRODUCTION)) {
      return "whop";
    }
    return mode;
  },
  /**
   * IA de secours de Packio Connect, après la lecture automatique (gratuite) :
   * Google Gemini si GEMINI_API_KEY est définie (offre gratuite), sinon Claude
   * si ANTHROPIC_API_KEY l'est. Clés lues côté serveur uniquement.
   */
  ai: {
    get provider(): "gemini" | "claude" | null {
      if (process.env.GEMINI_API_KEY) return "gemini";
      if (process.env.ANTHROPIC_API_KEY) return "claude";
      return null;
    },
    /** Modèle Gemini (offre gratuite). */
    get geminiModel() {
      return process.env.AI_GEMINI_MODEL || "gemini-3.5-flash-lite";
    },
    /** Budget mensuel en dollars (estimation à partir des jetons consommés). */
    get monthlyBudgetUsd() {
      const n = Number(process.env.AI_MONTHLY_BUDGET_USD);
      return Number.isFinite(n) && n >= 0 ? n : 15;
    },
    /** Nombre maximal d'appels par client et par jour. */
    get dailyCallsPerCustomer() {
      const n = Number.parseInt(process.env.AI_DAILY_CALLS_PER_CUSTOMER ?? "", 10);
      return Number.isFinite(n) && n >= 0 ? n : 6;
    },
  },
  whop: {
    /** Clé API du compte Whop (Developer → API keys). */
    get apiKey() {
      return (process.env.WHOP_API_KEY ?? "").trim();
    },
    /** Secret de signature du webhook (commence par « ws_ »). */
    get webhookSecret() {
      return (process.env.WHOP_WEBHOOK_SECRET ?? "").trim();
    },
    /** Identifiant du compte / de l'entreprise Whop (biz_…), repris même si un lien entier ou des espaces ont été collés. */
    get accountId() {
      const raw = (process.env.WHOP_ACCOUNT_ID ?? "").trim();
      return raw.match(/biz_[A-Za-z0-9]+/)?.[0] ?? raw;
    },
    /** Produit Whop auquel rattacher les plans créés à la volée (prod_…), facultatif. */
    get productId() {
      const raw = (process.env.WHOP_PRODUCT_ID ?? "").trim();
      return raw.match(/prod_[A-Za-z0-9]+/)?.[0] ?? raw;
    },
    /** "production" (défaut) ou "sandbox". */
    get environment(): "production" | "sandbox" {
      return process.env.WHOP_ENVIRONMENT === "sandbox" ? "sandbox" : "production";
    },
    /** Version d'API figée (en-tête Api-Version-Date), facultative. */
    get apiVersionDate() {
      return process.env.WHOP_API_VERSION_DATE ?? "";
    },
  },
  get resendApiKey() {
    return process.env.RESEND_API_KEY ?? "";
  },
  get emailFrom() {
    return process.env.EMAIL_FROM ?? "Packio <notifications@packio.local>";
  },
  get cronSecret() {
    return process.env.CRON_SECRET ?? "";
  },
  get storageDriver(): "local" | "s3" {
    return process.env.STORAGE_DRIVER === "s3" ? "s3" : "local";
  },
  get localStorageDir() {
    return process.env.LOCAL_STORAGE_DIR ?? "./storage";
  },
  s3: {
    get bucket() {
      return process.env.S3_BUCKET ?? "";
    },
    get region() {
      return process.env.S3_REGION ?? "auto";
    },
    get endpoint() {
      return process.env.S3_ENDPOINT ?? "";
    },
    get accessKeyId() {
      return process.env.S3_ACCESS_KEY_ID ?? "";
    },
    get secretAccessKey() {
      return process.env.S3_SECRET_ACCESS_KEY ?? "";
    },
  },
  get laPosteApiKey() {
    return process.env.LAPOSTE_API_KEY ?? "";
  },
  get secureCookies() {
    return process.env.NODE_ENV === "production" || this.appUrl.startsWith("https://");
  },
};
