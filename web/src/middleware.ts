import { clerkMiddleware } from "@clerk/nextjs/server";

/**
 * Clerk runs for optional account linking.
 * Sessions are public; mutations are password-gated (no anonymous cookie ownership).
 */
export default clerkMiddleware();

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
