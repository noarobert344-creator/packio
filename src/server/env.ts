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
  /** "stripe" (défaut) ou "dev" (paiements simulés, interdit en production). */
  get billingMode(): "stripe" | "dev" {
    const mode = process.env.BILLING_MODE === "dev" ? "dev" : "stripe";
    if (mode === "dev" && process.env.NODE_ENV === "production" && !bool(process.env.ALLOW_DEV_BILLING_IN_PRODUCTION)) {
      return "stripe";
    }
    return mode;
  },
  get stripeSecretKey() {
    return process.env.STRIPE_SECRET_KEY ?? "";
  },
  get stripeWebhookSecret() {
    return process.env.STRIPE_WEBHOOK_SECRET ?? "";
  },
  get stripeTaxEnabled() {
    return bool(process.env.STRIPE_AUTOMATIC_TAX);
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
