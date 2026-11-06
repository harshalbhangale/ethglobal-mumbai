import { type NextRequest, NextResponse } from "next/server";

/**
 * One address: kallmarkets.vercel.app. The project's older names still answer, so pages opened on them
 * move to the real one (sign-in with X only works there). API routes aren't redirected: Android builds and
 * older extensions still call the old origin and must keep working.
 */
export const CANONICAL_HOST = "kallmarkets.vercel.app";
const OLD_HOSTS = new Set(["kall-markets.vercel.app", "kallr.vercel.app", "kallr-app.vercel.app", "aftermarkets.vercel.app"]);

export function proxy(req: NextRequest) {
  const host = req.headers.get("host")?.toLowerCase() ?? "";
  if (!OLD_HOSTS.has(host)) return NextResponse.next();
  const url = new URL(req.nextUrl.pathname + req.nextUrl.search, `https://${CANONICAL_HOST}`);
  return NextResponse.redirect(url, 308);
}

export const config = {
  // Pages only: not /api, Next's own files, or static files like icons and the service worker.
  matcher: ["/((?!api/|_next/|.*\\.[a-z0-9]+$).*)"],
};
