// Authentication for /api/internal/* — the endpoints only n8n may call.
// A single shared secret in a header is appropriate for service-to-service
// calls inside our own infrastructure (n8n → app). Human-facing auth
// (sessions, roles) is a separate concern and arrives with the dashboard.
import { timingSafeEqual } from "node:crypto";

export function isInternalRequest(request: Request): boolean {
  const expected = process.env.INTERNAL_API_KEY;
  if (!expected) return false; // fail closed if the app is misconfigured

  const provided = request.headers.get("x-internal-api-key") ?? "";
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // timingSafeEqual requires equal lengths; length inequality is itself a mismatch
  return a.length === b.length && timingSafeEqual(a, b);
}

export function unauthorized(): Response {
  return Response.json({ error: "unauthorized" }, { status: 401 });
}
