// Route protection (Next 16 renamed "middleware" to "proxy"). This is the
// OPTIMISTIC check — it redirects unauthenticated visitors before a page
// renders. It is not the only line of defense: API route handlers verify
// the session themselves, because the docs are explicit that proxy alone
// must not be a full authorization solution.
import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session-token";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySessionToken(token) : null;

  if (pathname === "/login") {
    // Already signed in? Straight to the dashboard.
    return session
      ? NextResponse.redirect(new URL("/", request.url))
      : NextResponse.next();
  }

  if (!session) {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }
  return NextResponse.next();
}

export const config = {
  // Pages only: API routes authenticate themselves (session or internal key),
  // and _next/static assets are public.
  matcher: ["/((?!api|_next|favicon\\.ico|.*\\..*).*)"],
};
