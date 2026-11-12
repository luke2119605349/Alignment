import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Sessions are public and password-gated — no auth middleware required.
 * Clerk remains optional for "Link account" only; do not require clerkMiddleware
 * so production works even with development Clerk keys.
 */
export function middleware(_req: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
