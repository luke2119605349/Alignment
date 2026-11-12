import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import {
  alignments,
  alignmentSessions,
  baseWords,
  languages,
  sessionVerseSubmissions,
  verses,
} from "@/db/schema";
import { resolveAlignments } from "@/lib/alignments";
import {
  defaultAlignmentSourceId,
  diffAlignments,
  entriesFromPairs,
  listAlignmentSources,
  loadBaselineForVerse,
} from "@/lib/aqua_sources";
import { verifyPassword } from "@/lib/passwords";

type Ctx = { params: Promise<{ vid: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { vid } = await ctx.params;
  const url = new URL(req.url);
  const sessionId = url.searchParams.get("sessionId");
  const sourceCode = url.searchParams.get("source") ?? "lat";
  const targetCode = url.searchParams.get("target") ?? "grc";
  const sourceKey =
    url.searchParams.get("alignmentSource") ?? defaultAlignmentSourceId();
  const wantDiff = url.searchParams.get("diff") === "1";

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

  const greek = targetWords.map((w) => w.surface);
  const latin = sourceWords.map((w) => w.surface);

  const baselineEntries = loadBaselineForVerse(sourceKey, vid, latin);

  const { links, fromSession } = await resolveAlignments(
    verse.id,
    source.id,
    target.id,
    sessionId ? Number(sessionId) : null,
    sourceKey,
  );

  const latinEntries = fromSession
    ? entriesFromPairs(
        latin,
        greek,
        links.map((l) => ({
          sourceWordIndex: l.sourceWordIndex,
          targetWordIndex: l.targetWordIndex,
          score: l.score,
        })),
      )
    : baselineEntries.length && baselineEntries.some((e) => e.pairs.length)
      ? baselineEntries
      : entriesFromPairs(
          latin,
          greek,
          links.map((l) => ({
            sourceWordIndex: l.sourceWordIndex,
            targetWordIndex: l.targetWordIndex,
            score: l.score,
          })),
        );

  const alignmentJson = {
    vid,
    source: sourceKey,
    fromSession,
    list: latinEntries.map((e) => ({
      latin: e.latinWord,
      pairs: e.pairs.map((p) => [p.greekIdx, p.greekWord, p.confidence] as const),
    })),
  };

  const payload: Record<string, unknown> = {
    verse,
    greek,
    latin,
    latinEntries,
    baselineEntries,
    alignmentSource: sourceKey,
    sources: listAlignmentSources(),
    fromSession,
    alignmentJson,
    links,
  };

  if (wantDiff) {
    payload.diff = diffAlignments(baselineEntries, latinEntries);
  }

  return NextResponse.json(payload);
}

export async function PUT(req: Request, ctx: Ctx) {
  const { vid } = await ctx.params;
  const body = await req.json();
  const sessionId = Number(body.sessionId);
  const submit = Boolean(body.submit);
  const password = typeof body.password === "string" ? body.password : "";
  const pairs: { sourceWordIndex: number; targetWordIndex: number; score?: number }[] =
    body.pairs ?? [];

  if (!sessionId || !Array.isArray(pairs)) {
    return NextResponse.json({ error: "sessionId and pairs required" }, { status: 400 });
  }
  if (!password) {
    return NextResponse.json({ error: "Password required to modify session" }, { status: 401 });
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
          sourceKey: null,
        })),
      )
      .returning();
  }

  if (prior.length) {
    const marker = inserted[0]?.id ?? prior[0].id;
    for (const old of prior) {
      await db
        .update(alignments)
        .set({ supersededById: marker })
        .where(eq(alignments.id, old.id));
    }
  }

  if (submit) {
    const existing = await db
      .select()
      .from(sessionVerseSubmissions)
      .where(
        and(
          eq(sessionVerseSubmissions.sessionId, sessionId),
          eq(sessionVerseSubmissions.verseId, verse.id),
        ),
      )
      .limit(1);
    if (existing.length) {
      await db
        .update(sessionVerseSubmissions)
        .set({ submittedAt: new Date() })
        .where(eq(sessionVerseSubmissions.id, existing[0].id));
    } else {
      await db.insert(sessionVerseSubmissions).values({
        sessionId,
        verseId: verse.id,
      });
    }
  }

  return NextResponse.json({ saved: inserted.length, submitted: submit });
}
