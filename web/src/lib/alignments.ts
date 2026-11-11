import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { alignments } from "@/db/schema";

/** Resolve effective alignments for a verse: session overrides + system seed */
export async function resolveAlignments(
  verseId: number,
  sourceLanguageId: number,
  targetLanguageId: number,
  sessionId: number | null,
) {
  const db = getDb();
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
      ),
    );

  if (!sessionId) return system;

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

  if (sessionRows.length === 0) return system;
  return sessionRows;
}
