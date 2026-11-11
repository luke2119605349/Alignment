import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema";
import { computeMyersOps } from "../src/lib/myers";
import { NT_BOOKS } from "../src/lib/verse_data";

const ROOT = path.resolve(__dirname, "../..");
const ALIGN_FILES = path.join(ROOT, "alignment_feature", "files");
const AQUA_ALIGN = path.join(
  ALIGN_FILES,
  "options",
  "aqua_alignment_using_aqua.txt",
);

function readLines(filePath: string): string[] {
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter((l) => l.length > 0);
}

function pad3(n: number) {
  return String(n).padStart(3, "0");
}

function bookMeta(bookNum: number) {
  return NT_BOOKS.find((b) => b.num === bookNum);
}

async function batchInsert<T extends Record<string, unknown>>(
  db: ReturnType<typeof drizzle>,
  table: Parameters<typeof db.insert>[0],
  rows: T[],
  chunkSize = 500,
) {
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    if (chunk.length) await db.insert(table).values(chunk as never);
  }
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  const sql = neon(url);
  const db = drizzle(sql, { schema });

  console.log("Seeding languages…");
  await db
    .insert(schema.languages)
    .values([
      { code: "grc", name: "Greek (CNTR Classic)" },
      { code: "lat", name: "Latin (Stuttgart)" },
    ])
    .onConflictDoNothing();

  const langs = await db.select().from(schema.languages);
  const grc = langs.find((l) => l.code === "grc")!;
  const lat = langs.find((l) => l.code === "lat")!;

  console.log("Seeding manuscripts…");
  await db
    .insert(schema.manuscripts)
    .values([
      {
        languageId: grc.id,
        siglum: "CNTR",
        name: "CNTR Classic base",
        isBase: true,
      },
      {
        languageId: grc.id,
        siglum: "DEMO",
        name: "Demo variant (Matt 1:1 omit υιου δαυιδ)",
        isBase: false,
        notes: "Illustrative Myers ops only — not a real witness",
      },
      {
        languageId: lat.id,
        siglum: "STUTT",
        name: "Stuttgart Vulgate NT",
        isBase: true,
      },
    ])
    .onConflictDoNothing();

  const mss = await db.select().from(schema.manuscripts);
  const demoMss = mss.find((m) => m.siglum === "DEMO")!;

  const vids = readLines(path.join(ALIGN_FILES, "vref_ids.txt"));
  const refs = readLines(path.join(ALIGN_FILES, "ntvref.txt"));
  const greekLines = readLines(path.join(ALIGN_FILES, "greek.txt"));
  const latinLines = readLines(path.join(ALIGN_FILES, "latin.txt"));

  if (
    vids.length !== greekLines.length ||
    vids.length !== latinLines.length ||
    vids.length !== refs.length
  ) {
    throw new Error(
      `Line count mismatch: vids=${vids.length} refs=${refs.length} grc=${greekLines.length} lat=${latinLines.length}`,
    );
  }

  console.log(`Seeding ${vids.length} verses…`);
  const verseRows = vids.map((vid, i) => {
    const bookNum = Number(vid.slice(0, 2));
    const chapter = Number(vid.slice(2, 5));
    const verse = Number(vid.slice(5, 8));
    const book = bookMeta(bookNum);
    return {
      vid,
      bookNum,
      bookAbbr: book?.abbr ?? `B${bookNum}`,
      chapter,
      verse,
      ref: refs[i] ?? `${bookNum} ${chapter}:${verse}`,
    };
  });
  await batchInsert(db, schema.verses, verseRows);

  const verseRowsDb = await db.select().from(schema.verses);
  const verseByVid = new Map(verseRowsDb.map((v) => [v.vid, v]));

  const existingGrc = await db
    .select({ id: schema.baseWords.id })
    .from(schema.baseWords)
    .where(eq(schema.baseWords.languageId, grc.id))
    .limit(1);

  if (existingGrc.length === 0) {
    console.log("Seeding Greek + Latin base words…");
    const grcWords: {
      languageId: number;
      verseId: number;
      wordIndex: number;
      surface: string;
      collationId: string;
    }[] = [];
    const latWords: {
      languageId: number;
      verseId: number;
      wordIndex: number;
      surface: string;
    }[] = [];

    for (let i = 0; i < vids.length; i += 1) {
      const verse = verseByVid.get(vids[i]);
      if (!verse) continue;
      const gTokens = greekLines[i].split(/\s+/).filter(Boolean);
      const lTokens = latinLines[i].split(/\s+/).filter(Boolean);
      for (let wi = 0; wi < gTokens.length; wi += 1) {
        grcWords.push({
          languageId: grc.id,
          verseId: verse.id,
          wordIndex: wi,
          surface: gTokens[wi],
          collationId: `${vids[i]}${pad3(wi + 1)}`,
        });
      }
      for (let wi = 0; wi < lTokens.length; wi += 1) {
        latWords.push({
          languageId: lat.id,
          verseId: verse.id,
          wordIndex: wi,
          surface: lTokens[wi],
        });
      }
    }
    await batchInsert(db, schema.baseWords, grcWords, 800);
    await batchInsert(db, schema.baseWords, latWords, 800);
    console.log(`  Greek words: ${grcWords.length}, Latin: ${latWords.length}`);
  } else {
    console.log("Base words already present — skipping word import");
  }

  // Demo Myers variant: Matt 1:1 without "υιου δαυιδ" (indices 4–5)
  const matt11 = verseByVid.get("40001001");
  if (matt11 && demoMss) {
    const baseTokens = greekLines[0].split(/\s+/).filter(Boolean);
    const variant = baseTokens.filter((_, i) => i !== 4 && i !== 5);
    const ops = computeMyersOps(baseTokens, variant);
    await db
      .insert(schema.manuscriptVerseDiffs)
      .values({
        manuscriptId: demoMss.id,
        verseId: matt11.id,
        ops,
      })
      .onConflictDoNothing();
    console.log("Seeded DEMO Myers ops for Matt 1:1");
  }

  // System Aqua alignments (session_id NULL)
  const existingAlign = await db
    .select({ id: schema.alignments.id })
    .from(schema.alignments)
    .limit(1);

  if (existingAlign.length === 0 && fs.existsSync(AQUA_ALIGN)) {
    console.log("Seeding Aqua system alignments…");
    const lines = readLines(AQUA_ALIGN);
    // latinWord - COLLATIONID greek score
    // CollationId = BBCCCVVVWWW → vid=BBCCCVVV, greek wordIndex = WWW-1
    // Latin index: sequential within verse by order of latin words in file
    const latinCursorByVid = new Map<string, number>();
    const latinLinesByVid = new Map(
      vids.map((vid, i) => [
        vid,
        latinLines[i].split(/\s+/).filter(Boolean).map((w) => w.toLowerCase()),
      ]),
    );

    function nextLatinIndex(vid: string, latinWord: string): number {
      const tokens = latinLinesByVid.get(vid) ?? [];
      const key = latinWord.toLowerCase();
      let start = latinCursorByVid.get(vid) ?? 0;
      for (let i = start; i < tokens.length; i += 1) {
        if (tokens[i] === key) {
          latinCursorByVid.set(vid, i + 1);
          return i;
        }
      }
      return Math.min(start, Math.max(0, tokens.length - 1));
    }

    const alignRows: {
      verseId: number;
      sourceLanguageId: number;
      targetLanguageId: number;
      sourceWordIndex: number;
      targetWordIndex: number;
      score: number;
      sessionId: null;
    }[] = [];

    const re =
      /^(\S+)\s+-\s+(\d{11})\s+\S+\s+([0-9.]+)\s*$/;
    for (const line of lines) {
      const m = line.match(re);
      if (!m) continue;
      const [, latinWord, collationId, scoreStr] = m;
      const vid = collationId.slice(0, 8);
      const greekWordIndex = Number(collationId.slice(8, 11)) - 1;
      const verse = verseByVid.get(vid);
      if (!verse || greekWordIndex < 0) continue;
      const sourceWordIndex = nextLatinIndex(vid, latinWord);
      alignRows.push({
        verseId: verse.id,
        sourceLanguageId: lat.id,
        targetLanguageId: grc.id,
        sourceWordIndex,
        targetWordIndex: greekWordIndex,
        score: Number(scoreStr),
        sessionId: null,
      });
    }
    await batchInsert(db, schema.alignments, alignRows, 800);
    console.log(`  Alignments: ${alignRows.length}`);
  } else {
    console.log("Alignments already present or aqua file missing — skipping");
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
