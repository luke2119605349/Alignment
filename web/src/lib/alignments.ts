import { and, eq, isNull, or } from "drizzle-orm";
import { getDb } from "@/db";
import { alignments } from "@/db/schema";

/** Session overrides win; otherwise system rows for sourceKey (null treated as aqua). */
export async function resolveAlignments(
  verseId: number,
  sourceLanguageId: number,
  targetLanguageId: number,
  sessionId: number | null,
  sourceKey = "aqua",
) {
  const db = getDb();

  if (sessionId) {
    const sessionRows = await db
      .select()
      .from(alignments)
      .where(
        and(
          eq(alignments.verseId, verseId),
          eq(alignments.sourceLanguageId, sourceLanguageId),
          eq(alignments.targetLanguageId, targetLanguageId),
          eq(alignments.sessionId, sessionId),
          isNull(alignments.supersededById),
        ),
      );
    if (sessionRows.length > 0) return { links: sessionRows, fromSession: true };
  }

  const system = await db
    .select()
    .from(alignments)
    .where(
      and(
        eq(alignments.verseId, verseId),
        eq(alignments.sourceLanguageId, sourceLanguageId),
        eq(alignments.targetLanguageId, targetLanguageId),
        isNull(alignments.sessionId),
        isNull(alignments.supersededById),
        sourceKey === "aqua"
          ? or(eq(alignments.sourceKey, "aqua"), isNull(alignments.sourceKey))
          : eq(alignments.sourceKey, sourceKey),
      ),
    );

  return { links: system, fromSession: false };
}
