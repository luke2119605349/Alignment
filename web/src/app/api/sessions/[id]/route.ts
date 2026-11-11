import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import {
  alignments,
  alignmentSessions,
  sessionVerseSubmissions,
} from "@/db/schema";
import { getVolunteerId } from "@/lib/identity";

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(_req: Request, ctx: Ctx) {
  const volunteerId = await getVolunteerId();
  if (!volunteerId) {
    return NextResponse.json({ error: "Missing volunteer identity" }, { status: 401 });
  }

  const sessionId = Number((await ctx.params).id);
  if (!sessionId) {
    return NextResponse.json({ error: "Invalid session" }, { status: 400 });
  }

  const db = getDb();
  const [session] = await db
    .select()
    .from(alignmentSessions)
    .where(eq(alignmentSessions.id, sessionId))
    .limit(1);

  if (!session || session.clerkUserId !== volunteerId) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  await db
    .delete(sessionVerseSubmissions)
    .where(eq(sessionVerseSubmissions.sessionId, sessionId));
  await db.delete(alignments).where(eq(alignments.sessionId, sessionId));
  await db
    .delete(alignmentSessions)
    .where(
      and(
        eq(alignmentSessions.id, sessionId),
        eq(alignmentSessions.clerkUserId, volunteerId),
      ),
    );

  return NextResponse.json({ ok: true, deletedId: sessionId });
}
