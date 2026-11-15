/**
 * Erreur métier présentable à l'utilisateur (message en français).
 * Toute autre erreur est considérée comme interne et masquée.
 */
export class DomainError extends Error {
  readonly code: string;
  readonly status: number;
  readonly fieldErrors?: Record<string, string>;

  constructor(code: string, message: string, opts?: { status?: number; fieldErrors?: Record<string, string> }) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.status = opts?.status ?? 400;
    this.fieldErrors = opts?.fieldErrors;
  }
}

export class ForbiddenError extends DomainError {
  constructor(message = "Vous n'avez pas l'autorisation d'effectuer cette action.") {
    super("FORBIDDEN", message, { status: 403 });
    this.name = "ForbiddenError";
  }
}

export class NotFoundError extends DomainError {
  constructor(message = "Élément introuvable.") {
    super("NOT_FOUND", message, { status: 404 });
    this.name = "NotFoundError";
  }
}

export function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "P2002";
}
