import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const SCRYPT_COST = 16384;
const PASSWORD_MIN_LENGTH = 16;
const PASSWORD_MAX_LENGTH = 256;

export function hashStudioPassword(password: string): string {
  if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
    throw new Error("La contraseña debe tener entre 16 y 256 caracteres.");
  }

  const salt = randomBytes(16);
  const derivedKey = scryptSync(password, salt, 64, { N: SCRYPT_COST, r: 8, p: 1 });
  return `scrypt:${SCRYPT_COST}:${salt.toString("hex")}:${derivedKey.toString("hex")}`;
}

export function verifyStudioPassword(password: string, storedHash: string): boolean {
  if (!password || password.length > PASSWORD_MAX_LENGTH) return false;

  const parts = storedHash.split(":");
  if (parts.length !== 4 || parts[0] !== "scrypt" || parts[1] !== String(SCRYPT_COST)) {
    return false;
  }

  const salt = parts[2];
  const encodedHash = parts[3];
  if (!/^[0-9a-f]{32}$/.test(salt) || !/^[0-9a-f]{128}$/.test(encodedHash)) {
    return false;
  }

  const expectedHash = Buffer.from(encodedHash, "hex");
  const suppliedHash = scryptSync(password, Buffer.from(salt, "hex"), expectedHash.length, {
    N: SCRYPT_COST,
    r: 8,
    p: 1,
  });

  return timingSafeEqual(suppliedHash, expectedHash);
}

export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
