import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { alignmentSessions, languages } from "@/db/schema";

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getDb();
  const rows = await db
    .select()
    .from(alignmentSessions)
    .where(eq(alignmentSessions.clerkUserId, userId))
    .orderBy(alignmentSessions.createdAt);

  return NextResponse.json({ sessions: rows });
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const sourceCode = body.sourceLanguage ?? "lat";
  const targetCode = body.targetLanguage ?? "grc";
  const label = body.label ?? `${sourceCode}→${targetCode}`;

  const db = getDb();
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
      clerkUserId: userId,
      sourceLanguageId: source.id,
      targetLanguageId: target.id,
      label,
      status: "open",
    })
    .returning();

  return NextResponse.json({ session });
}
