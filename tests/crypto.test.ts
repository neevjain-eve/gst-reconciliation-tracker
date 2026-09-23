import { describe, expect, it } from "vitest";
import { decrypt, encrypt, signPayload, verifyPayload } from "@/lib/crypto";

describe("crypto", () => {
  it("round-trips and never repeats ciphertext", () => {
    const a = encrypt("1000.abcdef-refresh-token");
    const b = encrypt("1000.abcdef-refresh-token");
    expect(a).not.toBe(b);
    expect(a).not.toContain("refresh-token");
    expect(decrypt(a)).toBe("1000.abcdef-refresh-token");
  });
  it("detects tampering", () => {
    const enc = encrypt("secret");
    const parts = enc.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decrypt(parts.join("."))).toThrow();
  });
  it("signs and verifies expiring payloads", () => {
    process.env.NEXTAUTH_SECRET = "unit-test-secret";
    const token = signPayload({ org: "o1" }, 60);
    expect(verifyPayload<{ org: string }>(token)?.org).toBe("o1");
    expect(verifyPayload(token + "x")).toBeNull();
    expect(verifyPayload(signPayload({ org: "o1" }, -5))).toBeNull();
  });
});
