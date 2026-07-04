// JWT verify, isolated from next/headers so both server code and proxy.ts
// (which runs before the request reaches a route) can use it.
import { jwtVerify, SignJWT } from "jose";

const encodedKey = new TextEncoder().encode(process.env.SESSION_SECRET);

export const SESSION_COOKIE = "clara_session";
export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

export interface SessionPayload {
  userId: string;
  email: string;
  name: string;
  role: "ADMIN" | "REVIEWER";
  [key: string]: unknown; // jose requires an index signature on payloads
}

export async function signSessionToken(payload: SessionPayload): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .sign(encodedKey);
}

export async function verifySessionToken(
  token: string,
): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, encodedKey, {
      algorithms: ["HS256"],
    });
    return payload as unknown as SessionPayload;
  } catch {
    return null; // expired, tampered, or signed with an old secret
  }
}
