import { auth } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

export const VOLUNTEER_COOKIE = "cntr_vid";
const ONE_YEAR = 60 * 60 * 24 * 365;

export function newVolunteerId() {
  return `anon_${crypto.randomUUID()}`;
}

export function volunteerCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: ONE_YEAR,
    secure: process.env.NODE_ENV === "production",
  };
}

/** Ensure an anonymous volunteer cookie exists; return response + id. */
export function withVolunteerCookie(req: NextRequest, res = NextResponse.next()) {
  const existing = req.cookies.get(VOLUNTEER_COOKIE)?.value;
  if (existing) return { res, volunteerId: existing };
  const volunteerId = newVolunteerId();
  res.cookies.set(VOLUNTEER_COOKIE, volunteerId, volunteerCookieOptions());
  return { res, volunteerId };
}

/**
 * Stable volunteer key for session ownership.
 * Always prefer the anonymous cookie so optional Clerk sign-in does not
 * fork a volunteer's sessions.
 */
export async function getVolunteerId(): Promise<string | null> {
  const jar = await cookies();
  const cookieId = jar.get(VOLUNTEER_COOKIE)?.value;
  if (cookieId) return cookieId;
  // Fallback if middleware has not run (e.g. some test contexts)
  const { userId } = await auth();
  return userId ?? null;
}
