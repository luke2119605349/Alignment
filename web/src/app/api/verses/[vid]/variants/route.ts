import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import {
  baseWords,
  languages,
  manuscriptVerseDiffs,
  manuscripts,
  verses,
} from "@/db/schema";
import { applyMyersOps } from "@/lib/myers";
import type { MyersOp } from "@/db/schema";

type Ctx = { params: Promise<{ vid: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { vid } = await ctx.params;
  const url = new URL(req.url);
  const siglum = url.searchParams.get("manuscript");
  const langCode = url.searchParams.get("language") ?? "grc";

  const db = getDb();
  const [verse] = await db.select().from(verses).where(eq(verses.vid, vid)).limit(1);
  if (!verse) return NextResponse.json({ error: "Verse not found" }, { status: 404 });

  const [lang] = await db
    .select()
    .from(languages)
    .where(eq(languages.code, langCode))
    .limit(1);
  if (!lang) return NextResponse.json({ error: "Unknown language" }, { status: 400 });

  const base = await db
    .select()
    .from(baseWords)
    .where(and(eq(baseWords.languageId, lang.id), eq(baseWords.verseId, verse.id)))
    .orderBy(baseWords.wordIndex);

  const baseTokens = base.map((w) => w.surface);

  if (!siglum) {
    const mss = await db
      .select()
      .from(manuscripts)
      .where(eq(manuscripts.languageId, lang.id));
    return NextResponse.json({
      verse,
      base: baseTokens,
      manuscripts: mss,
    });
  }

  const [mss] = await db
    .select()
    .from(manuscripts)
    .where(
      and(eq(manuscripts.languageId, lang.id), eq(manuscripts.siglum, siglum)),
    )
    .limit(1);
  if (!mss) return NextResponse.json({ error: "Manuscript not found" }, { status: 404 });

  if (mss.isBase) {
    return NextResponse.json({
      verse,
      manuscript: mss,
      base: baseTokens,
      reconstructed: baseTokens,
      ops: [{ op: "equal", baseIndex: 0, length: baseTokens.length }],
    });
  }

  const [diff] = await db
    .select()
    .from(manuscriptVerseDiffs)
    .where(
      and(
        eq(manuscriptVerseDiffs.manuscriptId, mss.id),
        eq(manuscriptVerseDiffs.verseId, verse.id),
      ),
    )
    .limit(1);

  const ops = (diff?.ops ?? []) as MyersOp[];
  const reconstructed = ops.length ? applyMyersOps(baseTokens, ops) : baseTokens;

  return NextResponse.json({
    verse,
    manuscript: mss,
    base: baseTokens,
    reconstructed,
    ops,
  });
}
