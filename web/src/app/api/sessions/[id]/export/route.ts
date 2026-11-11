import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import {
  alignments,
  alignmentSessions,
  baseWords,
  sessionVerseSubmissions,
  verses,
} from "@/db/schema";
import { getVolunteerId } from "@/lib/identity";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
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

  const links = await db
    .select({
      verseId: alignments.verseId,
      vid: verses.vid,
      sourceWordIndex: alignments.sourceWordIndex,
      targetWordIndex: alignments.targetWordIndex,
      score: alignments.score,
    })
    .from(alignments)
    .innerJoin(verses, eq(verses.id, alignments.verseId))
    .where(
      and(
        eq(alignments.sessionId, sessionId),
        isNull(alignments.supersededById),
      ),
    );

  const submitted = await db
    .select({ vid: verses.vid })
    .from(sessionVerseSubmissions)
    .innerJoin(verses, eq(verses.id, sessionVerseSubmissions.verseId))
    .where(eq(sessionVerseSubmissions.sessionId, sessionId));

  const verseIds = [...new Set(links.map((l) => l.verseId))];
  const wordsByVerse = new Map<
    number,
    { latin: string[]; greek: string[] }
  >();

  for (const verseId of verseIds) {
    const [latinRows, greekRows] = await Promise.all([
      db
        .select()
        .from(baseWords)
        .where(
          and(
            eq(baseWords.verseId, verseId),
            eq(baseWords.languageId, session.sourceLanguageId),
          ),
        )
        .orderBy(baseWords.wordIndex),
      db
        .select()
        .from(baseWords)
        .where(
          and(
            eq(baseWords.verseId, verseId),
            eq(baseWords.languageId, session.targetLanguageId),
          ),
        )
        .orderBy(baseWords.wordIndex),
    ]);
    wordsByVerse.set(verseId, {
      latin: latinRows.map((w) => w.surface),
      greek: greekRows.map((w) => w.surface),
    });
  }

  const byVid = new Map<
    string,
    {
      vid: string;
      list: { latin: string; pairs: [number, string, number][] }[];
    }
  >();

  for (const link of links) {
    const words = wordsByVerse.get(link.verseId);
    if (!words) continue;
    let entry = byVid.get(link.vid);
    if (!entry) {
      entry = {
        vid: link.vid,
        list: words.latin.map((latin) => ({ latin, pairs: [] as [number, string, number][] })),
      };
      byVid.set(link.vid, entry);
    }
    const slot = entry.list[link.sourceWordIndex];
    if (!slot) continue;
    slot.pairs.push([
      link.targetWordIndex,
      words.greek[link.targetWordIndex] ?? "",
      link.score ?? 0,
    ]);
  }

  const payload = {
    sessionId,
    label: session.label,
    exportedAt: new Date().toISOString(),
    submittedVids: submitted.map((s) => s.vid),
    verses: Object.fromEntries(
      [...byVid.entries()].map(([vid, v]) => [vid, { vid: v.vid, list: v.list }]),
    ),
  };

  return NextResponse.json(payload);
}
