import fs from "node:fs";
import path from "node:path";

export type AlignmentSourceMeta = {
  id: string;
  displayName: string;
  filename: string;
  isDefault?: boolean;
};

export type AlignPair = {
  greekIdx: number;
  greekWord: string;
  confidence: number;
};

export type LatinAlignEntry = {
  latinWord: string;
  latinIndex: number;
  pairs: AlignPair[];
};

const DEFAULT_ID = "aqua";

const BUILTIN: AlignmentSourceMeta[] = [
  {
    id: "aqua",
    displayName: "Aqua alignment (default)",
    filename: "aqua_alignment_using_aqua.txt",
    isDefault: true,
  },
  {
    id: "bespoke",
    displayName: "Aqua alignment (bespoke)",
    filename: "aqua_alignment_using_bespoke.txt",
  },
];

function dataDir() {
  const candidates = [
    path.join(process.cwd(), "data", "alignments"),
    path.join(process.cwd(), "..", "alignment_feature", "files", "options"),
  ];
  return candidates.find((d) => fs.existsSync(path.join(d, "manifest.json"))) ?? candidates[0];
}

export function listAlignmentSources(): AlignmentSourceMeta[] {
  const dir = dataDir();
  const manifestPath = path.join(dir, "manifest.json");
  if (!fs.existsSync(manifestPath)) return BUILTIN;

  try {
    const raw = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
      displayName?: string;
      filename?: string;
    }[];
    return raw
      .filter((o) => o.filename)
      .map((o) => {
        const filename = o.filename!;
        const id = filename.includes("bespoke")
          ? "bespoke"
          : filename.includes("aqua")
            ? "aqua"
            : filename.replace(/\.[^.]+$/, "");
        return {
          id,
          displayName: o.displayName || filename,
          filename,
          isDefault: id === DEFAULT_ID,
        };
      });
  } catch {
    return BUILTIN;
  }
}

export function defaultAlignmentSourceId() {
  return listAlignmentSources().find((s) => s.isDefault)?.id ?? DEFAULT_ID;
}

type CacheEntry = Map<string, Omit<LatinAlignEntry, "latinIndex">[]>;

const fileCache = new Map<string, CacheEntry>();

function parseAlignmentText(text: string): CacheEntry {
  const byVid = new Map<string, Omit<LatinAlignEntry, "latinIndex">[]>();
  let currentVid: string | null = null;

  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const dashIdx = line.indexOf(" - ");
    if (dashIdx === -1) continue;
    const latinWord = line.slice(0, dashIdx);
    const rest = line.slice(dashIdx + 3).trim();
    const pairs: AlignPair[] = [];
    if (rest) {
      const parts = rest.split(/\s+/);
      for (let i = 0; i + 2 < parts.length; i += 3) {
        const wordId = Number(parts[i]);
        pairs.push({
          greekIdx: (wordId % 1000) - 1,
          greekWord: parts[i + 1],
          confidence: Number(parts[i + 2]),
        });
        if (!Number.isNaN(wordId)) {
          currentVid = String(Math.floor(wordId / 1000));
        }
      }
    }
    if (!currentVid) continue;
    const list = byVid.get(currentVid) ?? [];
    list.push({ latinWord, pairs });
    byVid.set(currentVid, list);
  }
  return byVid;
}

function loadSourceCache(sourceId: string): CacheEntry | null {
  if (fileCache.has(sourceId)) return fileCache.get(sourceId)!;
  const meta = listAlignmentSources().find((s) => s.id === sourceId);
  if (!meta) return null;
  const filePath = path.join(dataDir(), meta.filename);
  if (!fs.existsSync(filePath)) return null;
  const byVid = parseAlignmentText(fs.readFileSync(filePath, "utf8"));
  fileCache.set(sourceId, byVid);
  return byVid;
}

/** Baseline Aqua (or other) entries for a verse from option files. */
export function loadBaselineForVerse(
  sourceId: string,
  vid: string,
  latinWords: string[],
): LatinAlignEntry[] {
  const cache = loadSourceCache(sourceId);
  const raw = cache?.get(vid) ?? [];
  if (raw.length === 0) {
    return latinWords.map((latinWord, latinIndex) => ({
      latinWord,
      latinIndex,
      pairs: [],
    }));
  }

  // Prefer positional match to verse latin tokens when lengths agree
  if (raw.length === latinWords.length) {
    return latinWords.map((latinWord, latinIndex) => ({
      latinWord,
      latinIndex,
      pairs: raw[latinIndex]?.pairs ?? [],
    }));
  }

  return raw.map((entry, latinIndex) => ({
    latinWord: latinWords[latinIndex] ?? entry.latinWord,
    latinIndex,
    pairs: entry.pairs,
  }));
}

export function pairsFromEntries(entries: LatinAlignEntry[]) {
  return entries.flatMap((e) =>
    e.pairs.map((p) => ({
      sourceWordIndex: e.latinIndex,
      targetWordIndex: p.greekIdx,
      score: p.confidence,
    })),
  );
}

export function entriesFromPairs(
  latinWords: string[],
  greekWords: string[],
  pairs: { sourceWordIndex: number; targetWordIndex: number; score?: number | null }[],
): LatinAlignEntry[] {
  const byLatin = new Map<number, AlignPair[]>();
  for (const p of pairs) {
    const list = byLatin.get(p.sourceWordIndex) ?? [];
    list.push({
      greekIdx: p.targetWordIndex,
      greekWord: greekWords[p.targetWordIndex] ?? "",
      confidence: p.score ?? 0,
    });
    byLatin.set(p.sourceWordIndex, list);
  }
  return latinWords.map((latinWord, latinIndex) => ({
    latinWord,
    latinIndex,
    pairs: byLatin.get(latinIndex) ?? [],
  }));
}

/** Diff baseline vs current: added / removed / kept links */
export function diffAlignments(
  baseline: LatinAlignEntry[],
  current: LatinAlignEntry[],
) {
  const key = (s: number, t: number) => `${s}:${t}`;
  const base = new Set(
    baseline.flatMap((e) => e.pairs.map((p) => key(e.latinIndex, p.greekIdx))),
  );
  const cur = new Set(
    current.flatMap((e) => e.pairs.map((p) => key(e.latinIndex, p.greekIdx))),
  );
  const added: { latinIndex: number; greekIdx: number }[] = [];
  const removed: { latinIndex: number; greekIdx: number }[] = [];
  for (const k of cur) {
    if (!base.has(k)) {
      const [s, t] = k.split(":").map(Number);
      added.push({ latinIndex: s, greekIdx: t });
    }
  }
  for (const k of base) {
    if (!cur.has(k)) {
      const [s, t] = k.split(":").map(Number);
      removed.push({ latinIndex: s, greekIdx: t });
    }
  }
  return {
    added,
    removed,
    unchanged: [...cur].filter((k) => base.has(k)).length,
  };
}
