// Session management for the dashboard (human auth) — stateless JWT in an
// httpOnly cookie, per the Next.js authentication guide. Distinct from
// internal-auth.ts, which authenticates the n8n *service*.
import "server-only";
import { cookies } from "next/headers";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  signSessionToken,
  verifySessionToken,
  type SessionPayload,
} from "./session-token";

export async function createSession(payload: SessionPayload): Promise<void> {
  const token = await signSessionToken(payload);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true, // JS on the page can never read it — XSS containment
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export async function getSession(): Promise<SessionPayload | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? verifySessionToken(token) : null;
}

export async function destroySession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}
