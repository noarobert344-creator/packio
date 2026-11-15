import { randomInt } from "node:crypto";

// Alphabet Crockford sans caractères ambigus (I, L, O, U).
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function randomCode(length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

export type ReferencePrefix = "CMD" | "EXP" | "INC" | "PK" | "SKU";

/** Référence lisible, non séquentielle (n'expose pas le volume d'activité). */
export function reference(prefix: ReferencePrefix, length = 8): string {
  return `${prefix}-${randomCode(length)}`;
}
