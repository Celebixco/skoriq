import { createHmac, timingSafeEqual } from "node:crypto";
import type { AuthRole } from "./auth.types.js";

export interface AuthTokenClaims {
  sub: string;
  email: string;
  role: AuthRole;
  iat: number;
  exp: number;
}

const header = {
  alg: "HS256",
  typ: "JWT"
};

export function signAuthToken(input: Omit<AuthTokenClaims, "iat" | "exp">, secret: string, ttlSeconds: number, now = Math.floor(Date.now() / 1000)): string {
  const claims: AuthTokenClaims = {
    ...input,
    iat: now,
    exp: now + ttlSeconds
  };
  const encodedHeader = encodeJson(header);
  const encodedPayload = encodeJson(claims);
  const signature = sign(`${encodedHeader}.${encodedPayload}`, secret);
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

export function verifyAuthToken(token: string, secret: string, now = Math.floor(Date.now() / 1000)): AuthTokenClaims | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const encodedHeader = parts[0];
  const encodedPayload = parts[1];
  const signature = parts[2];
  if (!encodedHeader || !encodedPayload || !signature) return null;
  const expected = sign(`${encodedHeader}.${encodedPayload}`, secret);
  if (!safeEqual(signature, expected)) return null;

  try {
    const parsedHeader = decodeJson(encodedHeader) as { alg?: unknown; typ?: unknown };
    if (parsedHeader.alg !== "HS256" || parsedHeader.typ !== "JWT") return null;
    const claims = decodeJson(encodedPayload) as Partial<AuthTokenClaims>;
    if (!isClaims(claims)) return null;
    if (claims.exp <= now) return null;
    return claims;
  } catch {
    return null;
  }
}

function encodeJson(value: unknown) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeJson(value: string) {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
}

function sign(value: string, secret: string) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function isClaims(value: Partial<AuthTokenClaims>): value is AuthTokenClaims {
  return (
    typeof value.sub === "string" &&
    typeof value.email === "string" &&
    (value.role === "admin" || value.role === "member") &&
    typeof value.iat === "number" &&
    typeof value.exp === "number"
  );
}
