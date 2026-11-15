export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export function parsePage(v: string | string[] | undefined) {
  const n = Number(one(v));
  return Number.isInteger(n) && n > 0 ? n : 1;
}

export function oneOf<T extends string>(v: string | string[] | undefined, allowed: readonly T[]): T | undefined {
  const s = one(v);
  return s && (allowed as readonly string[]).includes(s) ? (s as T) : undefined;
}
