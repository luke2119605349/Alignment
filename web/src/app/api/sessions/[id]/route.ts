import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { alignmentSessions } from "@/db/schema";
import { verifyPassword } from "@/lib/passwords";

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(req: Request, ctx: Ctx) {
  const sessionId = Number((await ctx.params).id);
  if (!sessionId) {
    return NextResponse.json({ error: "Invalid session" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const password = typeof body.password === "string" ? body.password : "";
  if (!password) {
    return NextResponse.json({ error: "Password required" }, { status: 401 });
  }

  const db = getDb();
  const [session] = await db
    .select()
    .from(alignmentSessions)
    .where(eq(alignmentSessions.id, sessionId))
    .limit(1);

  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  if (!verifyPassword(password, session.passwordHash)) {
    return NextResponse.json({ error: "Incorrect password" }, { status: 403 });
  }

  // Child rows (alignments, session_verse_submissions) cascade via FK.
  await db
    .delete(alignmentSessions)
    .where(eq(alignmentSessions.id, sessionId));

  return NextResponse.json({ ok: true, deletedId: sessionId });
}
