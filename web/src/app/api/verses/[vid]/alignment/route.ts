import { auth } from "@clerk/nextjs/server";
import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import {
  alignments,
  alignmentSessions,
  baseWords,
  languages,
  verses,
} from "@/db/schema";
import { resolveAlignments } from "@/lib/alignments";

type Ctx = { params: Promise<{ vid: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { vid } = await ctx.params;
  const url = new URL(req.url);
  const sessionId = url.searchParams.get("sessionId");
  const sourceCode = url.searchParams.get("source") ?? "lat";
  const targetCode = url.searchParams.get("target") ?? "grc";

  const db = getDb();
  const [verse] = await db.select().from(verses).where(eq(verses.vid, vid)).limit(1);
  if (!verse) return NextResponse.json({ error: "Verse not found" }, { status: 404 });

  const langs = await db.select().from(languages);
  const source = langs.find((l) => l.code === sourceCode);
  const target = langs.find((l) => l.code === targetCode);
  if (!source || !target) {
    return NextResponse.json({ error: "Unknown language" }, { status: 400 });
  }

  const [sourceWords, targetWords] = await Promise.all([
    db
      .select()
      .from(baseWords)
      .where(and(eq(baseWords.languageId, source.id), eq(baseWords.verseId, verse.id)))
      .orderBy(baseWords.wordIndex),
    db
      .select()
      .from(baseWords)
      .where(and(eq(baseWords.languageId, target.id), eq(baseWords.verseId, verse.id)))
      .orderBy(baseWords.wordIndex),
  ]);

  const links = await resolveAlignments(
    verse.id,
    source.id,
    target.id,
    sessionId ? Number(sessionId) : null,
  );

  // Shape for the UI: latin-indexed list like aqua output
  const byLatin = new Map<number, { greekIdx: number; confidence: number | null }[]>();
  for (const link of links) {
    const list = byLatin.get(link.sourceWordIndex) ?? [];
    list.push({
      greekIdx: link.targetWordIndex,
      confidence: link.score,
    });
    byLatin.set(link.sourceWordIndex, list);
  }

  const latinEntries = sourceWords.map((w) => ({
    latinWord: w.surface,
    latinIndex: w.wordIndex,
    pairs: (byLatin.get(w.wordIndex) ?? []).map((p) => ({
      greekIdx: p.greekIdx,
      greekWord: targetWords.find((g) => g.wordIndex === p.greekIdx)?.surface ?? "",
      confidence: p.confidence ?? 0,
    })),
  }));

  return NextResponse.json({
    verse,
    greek: targetWords.map((w) => w.surface),
    latin: sourceWords.map((w) => w.surface),
    latinEntries,
    links,
  });
}

export async function PUT(req: Request, ctx: Ctx) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { vid } = await ctx.params;
  const body = await req.json();
  const sessionId = Number(body.sessionId);
  const pairs: { sourceWordIndex: number; targetWordIndex: number; score?: number }[] =
    body.pairs ?? [];

  if (!sessionId || !Array.isArray(pairs)) {
    return NextResponse.json({ error: "sessionId and pairs required" }, { status: 400 });
  }

  const db = getDb();
  const [session] = await db
    .select()
    .from(alignmentSessions)
    .where(eq(alignmentSessions.id, sessionId))
    .limit(1);

  if (!session || session.clerkUserId !== userId) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  if (session.status !== "open") {
    return NextResponse.json({ error: "Session is closed" }, { status: 400 });
  }

  const [verse] = await db.select().from(verses).where(eq(verses.vid, vid)).limit(1);
  if (!verse) return NextResponse.json({ error: "Verse not found" }, { status: 404 });

  const prior = await db
    .select()
    .from(alignments)
    .where(
      and(
        eq(alignments.verseId, verse.id),
        eq(alignments.sessionId, sessionId),
        isNull(alignments.supersededById),
      ),
    );

  let inserted: (typeof alignments.$inferSelect)[] = [];
  if (pairs.length > 0) {
    inserted = await db
      .insert(alignments)
      .values(
        pairs.map((p) => ({
          verseId: verse.id,
          sourceLanguageId: session.sourceLanguageId,
          targetLanguageId: session.targetLanguageId,
          sourceWordIndex: p.sourceWordIndex,
          targetWordIndex: p.targetWordIndex,
          score: p.score ?? null,
          sessionId,
        })),
      )
      .returning();
  }

  // Soft-supersede prior session rows (marker = first new id, or self for clear)
  if (prior.length) {
    const marker = inserted[0]?.id ?? prior[0].id;
    for (const old of prior) {
      await db
        .update(alignments)
        .set({ supersededById: marker })
        .where(eq(alignments.id, old.id));
    }
  }

  return NextResponse.json({ saved: inserted.length });
}
