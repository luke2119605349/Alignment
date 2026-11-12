import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import {
  alignmentSessions,
  sessionVerseSubmissions,
  verses,
} from "@/db/schema";

type Ctx = { params: Promise<{ id: string }> };

/** Submitted vids for progress UI — public read. */
export async function GET(_req: Request, ctx: Ctx) {
  const sessionId = Number((await ctx.params).id);
  if (!sessionId) {
    return NextResponse.json({ error: "Invalid session" }, { status: 400 });
  }

  const db = getDb();
  const [session] = await db
    .select({ id: alignmentSessions.id })
    .from(alignmentSessions)
    .where(eq(alignmentSessions.id, sessionId))
    .limit(1);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

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
