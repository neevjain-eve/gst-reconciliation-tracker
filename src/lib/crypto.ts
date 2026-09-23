import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Secrets at rest: AES-256-GCM with a random 96-bit IV per value.
 * Stored format: `v1.<iv>.<tag>.<ciphertext>` (all base64url).
 * The key comes from ENCRYPTION_KEY (32 random bytes, base64). Nothing decrypted is ever sent to the browser.
 */
function getKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) throw new Error("ENCRYPTION_KEY is not set. Generate one with: openssl rand -base64 32");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("ENCRYPTION_KEY must decode to exactly 32 bytes (openssl rand -base64 32).");
  return key;
}

export function encrypt(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), ct.toString("base64url")].join(".");
}

export function decrypt(payload: string): string {
  const [version, iv, tag, ct] = payload.split(".");
  if (version !== "v1" || !iv || !tag || !ct) throw new Error("Unsupported ciphertext format");
  const decipher = createDecipheriv("aes-256-gcm", getKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
}

export function sha256(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

// ── Signed, expiring tokens (used for the OAuth `state` parameter) ──────────────────────────

function signingSecret(): string {
  const s = process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error("NEXTAUTH_SECRET is not set");
  return s;
}

export function signPayload(payload: Record<string, unknown>, ttlSeconds: number): string {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds })).toString("base64url");
  const mac = createHmac("sha256", signingSecret()).update(body).digest("base64url");
  return `${body}.${mac}`;
}

export function verifyPayload<T extends Record<string, unknown>>(token: string): T | null {
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const expected = createHmac("sha256", signingSecret()).update(body).digest();
  const given = Buffer.from(mac, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T & { exp?: number };
    if (!data.exp || data.exp < Math.floor(Date.now() / 1000)) return null;
    return data;
  } catch {
    return null;
  }
}
