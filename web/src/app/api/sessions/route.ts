import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { alignmentSessions, languages } from "@/db/schema";
import { getVolunteerId } from "@/lib/identity";

function normalizeName(raw: unknown) {
  return typeof raw === "string" ? raw.trim() : "";
}

export async function GET() {
  const volunteerId = await getVolunteerId();
  if (!volunteerId) {
    return NextResponse.json({ error: "Missing volunteer identity" }, { status: 401 });
  }

  const db = getDb();
  const rows = await db
    .select()
    .from(alignmentSessions)
    .where(eq(alignmentSessions.clerkUserId, volunteerId))
    .orderBy(alignmentSessions.createdAt);

  return NextResponse.json({ sessions: rows, volunteerId });
}

export async function POST(req: Request) {
  const volunteerId = await getVolunteerId();
  if (!volunteerId) {
    return NextResponse.json({ error: "Missing volunteer identity" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const sourceCode = body.sourceLanguage ?? "lat";
  const targetCode = body.targetLanguage ?? "grc";
  const label = normalizeName(body.label ?? body.name);
  const username = normalizeName(body.username);

  if (!label) {
    return NextResponse.json({ error: "Session name is required" }, { status: 400 });
  }
  if (!username) {
    return NextResponse.json({ error: "Username is required" }, { status: 400 });
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
      clerkUserId: volunteerId,
      sourceLanguageId: source.id,
      targetLanguageId: target.id,
      label,
      username,
      status: "open",
    })
    .returning();

  return NextResponse.json({ session });
}
