import { NT_BOOKS } from "@/lib/verse_data";

export function pad3(n: number) {
  return String(n).padStart(3, "0");
}

export function vidFor(bookNum: number, chapter: number, verse: number) {
  return `${bookNum}${pad3(chapter)}${pad3(verse)}`;
}

export type ProgressTone = "untouched" | "partial" | "complete";

/** Red → yellow/orange gradient → green */
export function progressColor(pct: number): string {
  const p = Math.max(0, Math.min(1, pct));
  if (p <= 0) return "#e57373";
  if (p >= 1) return "#66bb6a";
  // 0..1 maps yellow (#ffeb3b) → orange (#ff9800)
  const t = p;
  const r = Math.round(255);
  const g = Math.round(235 + (152 - 235) * t);
  const b = Math.round(59 + (0 - 59) * t);
  return `rgb(${r},${g},${b})`;
}

export function toneFromPct(pct: number): ProgressTone {
  if (pct <= 0) return "untouched";
  if (pct >= 1) return "complete";
  return "partial";
}

export function isVerseComplete(completed: Set<string>, bookNum: number, chapter: number, verse: number) {
  return completed.has(vidFor(bookNum, chapter, verse));
}

export function chapterCompletion(
  completed: Set<string>,
  bookNum: number,
  chapter: number,
  verseCount: number,
) {
  let done = 0;
  for (let v = 1; v <= verseCount; v += 1) {
    if (isVerseComplete(completed, bookNum, chapter, v)) done += 1;
  }
  const pct = verseCount === 0 ? 0 : done / verseCount;
  return { done, total: verseCount, pct, complete: done === verseCount && verseCount > 0 };
}

export function bookCompletion(completed: Set<string>, bookIdx: number) {
  const book = NT_BOOKS[bookIdx];
  if (!book) return { done: 0, total: 0, pct: 0, complete: false, chapterPcts: [] as number[] };
  const chapterPcts: number[] = [];
  let chaptersDone = 0;
  for (let c = 1; c <= book.verseCounts.length; c += 1) {
    const ch = chapterCompletion(completed, book.num, c, book.verseCounts[c - 1] ?? 0);
    chapterPcts.push(ch.pct);
    if (ch.complete) chaptersDone += 1;
  }
  const total = book.verseCounts.length;
  const pct = total === 0 ? 0 : chaptersDone / total;
  return {
    done: chaptersDone,
    total,
    pct,
    complete: chaptersDone === total && total > 0,
    chapterPcts,
  };
}

export function ntCompletion(completed: Set<string>) {
  let booksDone = 0;
  const bookPcts: number[] = [];
  for (let i = 0; i < NT_BOOKS.length; i += 1) {
    const b = bookCompletion(completed, i);
    bookPcts.push(b.pct);
    if (b.complete) booksDone += 1;
  }
  const total = NT_BOOKS.length;
  const pct = total === 0 ? 0 : booksDone / total;
  return { done: booksDone, total, pct, complete: booksDone === total && total > 0, bookPcts };
}

/** Advance to the next verse in NT order; null if at the end. */
export function nextVerseRef(bookIdx: number, chapter: number, verse: number) {
  const book = NT_BOOKS[bookIdx];
  if (!book) return null;
  const verseCount = book.verseCounts[chapter - 1] ?? 0;
  if (verse < verseCount) {
    return { bookIdx, chapter, verse: verse + 1 };
  }
  if (chapter < book.verseCounts.length) {
    return { bookIdx, chapter: chapter + 1, verse: 1 };
  }
  if (bookIdx + 1 < NT_BOOKS.length) {
    return { bookIdx: bookIdx + 1, chapter: 1, verse: 1 };
  }
  return null;
}
