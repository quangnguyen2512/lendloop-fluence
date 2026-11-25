import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import type { NextFetchEvent, NextRequest } from "next/server";

const clerkConfigured = Boolean(
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY &&
    process.env.CLERK_SECRET_KEY
);

const activeClerkMiddleware = clerkMiddleware();

/**
 * Uses Clerk's real `clerkMiddleware()` when Clerk credentials are configured.
 * Falls back safely in Local Demo Mode so the app builds & runs locally without
 * crashing when cloud env vars have not been linked yet.
 *
 * NOTE: Public landing page (`/`) and HMAC-verified automation endpoints
 * (`/api/automation/*`) remain reachable without a browser session; all
 * protected mutations enforce RBAC server-side inside Convex & API handlers.
 */
export default function middleware(req: NextRequest, event: NextFetchEvent) {
  if (clerkConfigured) {
    return activeClerkMiddleware(req, event);
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
