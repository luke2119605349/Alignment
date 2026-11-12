import { asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { alignmentSessions, languages } from "@/db/schema";
import { hashPassword, publicSession } from "@/lib/passwords";

function normalizeName(raw: unknown) {
  return typeof raw === "string" ? raw.trim() : "";
}

/** All sessions are public (password hashes stripped). */
export async function GET() {
  const db = getDb();
  const rows = await db
    .select({
      id: alignmentSessions.id,
      label: alignmentSessions.label,
      username: alignmentSessions.username,
      status: alignmentSessions.status,
      createdAt: alignmentSessions.createdAt,
      closedAt: alignmentSessions.closedAt,
      sourceLanguageId: alignmentSessions.sourceLanguageId,
      targetLanguageId: alignmentSessions.targetLanguageId,
    })
    .from(alignmentSessions)
    .orderBy(asc(alignmentSessions.createdAt));

  return NextResponse.json({ sessions: rows });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const sourceCode = body.sourceLanguage ?? "lat";
  const targetCode = body.targetLanguage ?? "grc";
  const label = normalizeName(body.label ?? body.name);
  const username = normalizeName(body.username);
  const password = typeof body.password === "string" ? body.password : "";

  if (!label) {
    return NextResponse.json({ error: "Session name is required" }, { status: 400 });
  }
  if (!username) {
    return NextResponse.json({ error: "Username is required" }, { status: 400 });
  }
  if (!password.trim()) {
    return NextResponse.json({ error: "Password is required" }, { status: 400 });
  }
  if (password.length < 4) {
    return NextResponse.json(
      { error: "Password must be at least 4 characters" },
      { status: 400 },
    );
  }

  const db = getDb();

  const existing = await db
    .select({ id: alignmentSessions.id })
    .from(alignmentSessions)
    .where(eq(alignmentSessions.label, label))
    .limit(1);
  if (existing.length > 0) {
    return NextResponse.json(
      { error: "Session name must be unique" },
      { status: 409 },
    );
  }

  const langs = await db.select().from(languages);
  const source = langs.find((l) => l.code === sourceCode);
  const target = langs.find((l) => l.code === targetCode);
  if (!source || !target) {
    return NextResponse.json(
      { error: "Languages not seeded (need grc/lat)" },
      { status: 400 },
    );
  }

  const [session] = await db
    .insert(alignmentSessions)
    .values({
      clerkUserId: "public",
      sourceLanguageId: source.id,
      targetLanguageId: target.id,
      label,
      username,
      passwordHash: hashPassword(password),
      status: "open",
    })
    .returning();

  return NextResponse.json({ session: publicSession(session) });
}
