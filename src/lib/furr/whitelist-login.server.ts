// Server-only helpers for the whitelist login (name + password after Discord).
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string | null) {
  if (!stored) return false;
  const [kind, saltHex, keyHex] = stored.split("$");
  if (kind !== "scrypt" || !saltHex || !keyHex) return false;
  const expected = Buffer.from(keyHex, "hex");
  const actual = await scrypt(password, Buffer.from(saltHex, "hex"), expected.length);
  return timingSafeEqual(actual, expected);
}

/**
 * A stable key for the current login session (hash of the Better Auth session token):
 * the cookie when deployed, the bearer token in the live preview.
 */
export async function currentSessionKey(bearerToken?: string) {
  const { readSessionToken } = await import("@/lib/auth/server");
  const token = bearerToken || readSessionToken();
  return token ? createHash("sha256").update(token).digest("hex") : null;
}
