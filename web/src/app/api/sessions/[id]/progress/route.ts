import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import {
  alignmentSessions,
  sessionVerseSubmissions,
  verses,
} from "@/db/schema";
import { getVolunteerId } from "@/lib/identity";

type Ctx = { params: Promise<{ id: string }> };

async function loadOwnedSession(sessionId: number, volunteerId: string) {
  const db = getDb();
  const [session] = await db
    .select()
    .from(alignmentSessions)
    .where(eq(alignmentSessions.id, sessionId))
    .limit(1);
  if (!session || session.clerkUserId !== volunteerId) return null;
  return session;
}

/** Submitted vids + draft verse ids for progress UI */
export async function GET(_req: Request, ctx: Ctx) {
  const volunteerId = await getVolunteerId();
  if (!volunteerId) {
    return NextResponse.json({ error: "Missing volunteer identity" }, { status: 401 });
  }
  const sessionId = Number((await ctx.params).id);
  if (!sessionId) {
    return NextResponse.json({ error: "Invalid session" }, { status: 400 });
  }
  const session = await loadOwnedSession(sessionId, volunteerId);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const db = getDb();
  const submitted = await db
    .select({
      verseId: sessionVerseSubmissions.verseId,
      vid: verses.vid,
      submittedAt: sessionVerseSubmissions.submittedAt,
    })
    .from(sessionVerseSubmissions)
    .innerJoin(verses, eq(verses.id, sessionVerseSubmissions.verseId))
    .where(eq(sessionVerseSubmissions.sessionId, sessionId));

  return NextResponse.json({
    sessionId,
    submittedVids: submitted.map((r) => r.vid),
    submitted,
  });
}
