import { clerkMiddleware } from "@clerk/nextjs/server";
import { withVolunteerCookie } from "@/lib/identity";

/**
 * Clerk runs for optional account linking later.
 * Routes are not protected — volunteers are tracked via anonymous cookie.
 */
export default clerkMiddleware(async (_auth, req) => {
  const { res } = withVolunteerCookie(req);
  return res;
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
