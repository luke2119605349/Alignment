import { randomBytes, scryptSync, timingSafeEqual } from "crypto";

/** Store as `saltHex:hashHex`. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string | null | undefined): boolean {
  if (!stored || typeof password !== "string" || password.length === 0) return false;
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  try {
    const next = scryptSync(password, salt, 64);
    const prev = Buffer.from(hash, "hex");
    if (prev.length !== next.length) return false;
    return timingSafeEqual(prev, next);
  } catch {
    return false;
  }
}

export function publicSession<T extends { passwordHash?: string | null }>(row: T) {
  const { passwordHash: _omit, ...rest } = row;
  return rest;
}
