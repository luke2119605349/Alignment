"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlignmentCanvas,
  type LatinAlignEntry,
} from "@/components/AlignmentCanvas";
import { NT_BOOKS } from "@/lib/verse_data";

type Session = { id: number; label: string | null; status: string };
type SourceMeta = { id: string; displayName: string; filename: string; isDefault?: boolean };
type DiffResult = {
  added: { latinIndex: number; greekIdx: number }[];
  removed: { latinIndex: number; greekIdx: number }[];
  unchanged: number;
};

const SOURCE_PREF_KEY = "cntr_align_source";

function pad3(n: number) {
  return String(n).padStart(3, "0");
}

function vidFor(bookNum: number, chapter: number, verse: number) {
  return `${bookNum}${pad3(chapter)}${pad3(verse)}`;
}

function editsFromEntries(entries: LatinAlignEntry[]) {
  const next: Record<number, string> = {};
  for (const entry of entries) {
    next[entry.latinIndex] = entry.pairs.map((p) => p.greekIdx).join(",");
  }
  return next;
}

export function AlignmentWorkspace() {
  const [bookIdx, setBookIdx] = useState(0);
  const [chapter, setChapter] = useState(1);
  const [verse, setVerse] = useState(1);
  const [session, setSession] = useState<Session | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sources, setSources] = useState<SourceMeta[]>([]);
  const [alignmentSource, setAlignmentSource] = useState("aqua");
  const [greek, setGreek] = useState<string[]>([]);
  const [latinEntries, setLatinEntries] = useState<LatinAlignEntry[]>([]);
  const [baselineEntries, setBaselineEntries] = useState<LatinAlignEntry[]>([]);
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [baselineEdits, setBaselineEdits] = useState<Record<number, string>>({});
  const [alignmentJson, setAlignmentJson] = useState<unknown>(null);
  const [fromSession, setFromSession] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const [showJson, setShowJson] = useState(false);
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  const book = NT_BOOKS[bookIdx];
  const vid = useMemo(
    () => vidFor(book.num, chapter, verse),
    [book.num, chapter, verse],
  );

  useEffect(() => {
    try {
      const saved = localStorage.getItem(SOURCE_PREF_KEY);
      if (saved) setAlignmentSource(saved);
    } catch {
      /* ignore */
    }
  }, []);

  const refreshSessions = useCallback(async () => {
    const res = await fetch("/api/sessions");
    if (!res.ok) return;
    const data = await res.json();
    const list: Session[] = data.sessions ?? [];
    setSessions(list);
    return list;
  }, []);

  const createSession = useCallback(async () => {
    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceLanguage: "lat",
        targetLanguage: "grc",
        label: "Latin → Greek",
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setStatus(data.error ?? "Could not create session");
      return null;
    }
    setSession(data.session);
    await refreshSessions();
    return data.session as Session;
  }, [refreshSessions]);

  useEffect(() => {
    void (async () => {
      const list = (await refreshSessions()) ?? [];
      const open = list.find((s) => s.status === "open") ?? null;
      setSession((prev) => {
        if (prev && list.some((s) => s.id === prev.id)) return prev;
        return open;
      });
      if (!open) await createSession();
    })();
  }, [createSession, refreshSessions]);

  const loadVerse = useCallback(
    async (sess: Session | null, source: string, withDiff: boolean) => {
      if (!sess) return;
      setLoading(true);
      setStatus("");
      try {
        const qs = new URLSearchParams({
          sessionId: String(sess.id),
          source: "lat",
          target: "grc",
          alignmentSource: source,
        });
        if (withDiff) qs.set("diff", "1");
        const res = await fetch(`/api/verses/${vid}/alignment?${qs}`);
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          setStatus(err.error ?? `Load failed (${res.status})`);
          setGreek([]);
          setLatinEntries([]);
          return;
        }
        const data = await res.json();
        setGreek(data.greek ?? []);
        setLatinEntries(data.latinEntries ?? []);
        setBaselineEntries(data.baselineEntries ?? []);
        setEdits(editsFromEntries(data.latinEntries ?? []));
        setBaselineEdits(editsFromEntries(data.baselineEntries ?? []));
        setAlignmentJson(data.alignmentJson ?? null);
        setFromSession(Boolean(data.fromSession));
        setSources(data.sources ?? []);
        setDiff(data.diff ?? null);
        if (data.alignmentSource) setAlignmentSource(data.alignmentSource);
      } finally {
        setLoading(false);
      }
    },
    [vid],
  );

  useEffect(() => {
    if (session) void loadVerse(session, alignmentSource, showDiff);
  }, [session, vid, alignmentSource, showDiff, loadVerse]);

  function onSourceChange(id: string) {
    setAlignmentSource(id);
    try {
      localStorage.setItem(SOURCE_PREF_KEY, id);
    } catch {
      /* ignore */
    }
  }

  async function save() {
    if (!session) return;
    const pairs: {
      sourceWordIndex: number;
      targetWordIndex: number;
      score?: number;
    }[] = [];
    for (const entry of latinEntries) {
      const raw = edits[entry.latinIndex] ?? "";
      raw.split(",").forEach((part) => {
        const trimmed = part.trim();
        if (trimmed === "") return;
        const idx = Number(trimmed);
        if (Number.isInteger(idx) && idx >= 0 && idx < greek.length) {
          pairs.push({
            sourceWordIndex: entry.latinIndex,
            targetWordIndex: idx,
          });
        }
      });
    }
    const res = await fetch(`/api/verses/${vid}/alignment`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: session.id, pairs }),
    });
    const data = await res.json();
    setStatus(res.ok ? `Saved ${data.saved} links` : data.error ?? "Save failed");
    if (res.ok) await loadVerse(session, alignmentSource, showDiff);
  }

  function resetToBaseline() {
    setEdits({ ...baselineEdits });
    setStatus("Restored default indices for this verse (not saved yet)");
  }

  function clearLinks() {
    const next: Record<number, string> = {};
    for (const entry of latinEntries) next[entry.latinIndex] = "";
    setEdits(next);
  }

  const liveDiff = useMemo(() => {
    if (!showDiff) return null;
    if (diff && fromSession) return diff;
    // Compute client-side vs baseline while editing
    const key = (s: number, t: number) => `${s}:${t}`;
    const base = new Set<string>();
    const cur = new Set<string>();
    for (const e of baselineEntries) {
      for (const p of e.pairs) base.add(key(e.latinIndex, p.greekIdx));
    }
    for (const e of latinEntries) {
      const raw = edits[e.latinIndex] ?? "";
      raw.split(",").forEach((part) => {
        const n = Number(part.trim());
        if (Number.isInteger(n)) cur.add(key(e.latinIndex, n));
      });
    }
    const added: DiffResult["added"] = [];
    const removed: DiffResult["removed"] = [];
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
    return { added, removed, unchanged: [...cur].filter((k) => base.has(k)).length };
  }, [baselineEntries, diff, edits, fromSession, latinEntries, showDiff]);

  const chapters = book.verseCounts.length;
  const verseCount = book.verseCounts[chapter - 1] ?? 1;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm italic">
          Session
          <select
            className="ml-2 border border-[#888] bg-white px-2 py-1"
            value={session?.id ?? ""}
            onChange={(e) => {
              const id = Number(e.target.value);
              setSession(sessions.find((s) => s.id === id) ?? null);
            }}
          >
            <option value="">Select…</option>
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                #{s.id} {s.label ?? ""} ({s.status})
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => void createSession()}
          className="rounded border border-black bg-[#C1FCC1] px-3 py-1 text-sm"
        >
          New session
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          className="border border-[#888] bg-white px-2 py-1"
          value={bookIdx}
          onChange={(e) => {
            setBookIdx(Number(e.target.value));
            setChapter(1);
            setVerse(1);
          }}
        >
          {NT_BOOKS.map((b, i) => (
            <option key={b.num} value={i}>
              {b.name}
            </option>
          ))}
        </select>
        <select
          className="border border-[#888] bg-white px-2 py-1"
          value={chapter}
          onChange={(e) => {
            setChapter(Number(e.target.value));
            setVerse(1);
          }}
        >
          {Array.from({ length: chapters }, (_, i) => (
            <option key={i + 1} value={i + 1}>
              {i + 1}
            </option>
          ))}
        </select>
        <span>:</span>
        <select
          className="border border-[#888] bg-white px-2 py-1"
          value={verse}
          onChange={(e) => setVerse(Number(e.target.value))}
        >
          {Array.from({ length: verseCount }, (_, i) => (
            <option key={i + 1} value={i + 1}>
              {i + 1}
            </option>
          ))}
        </select>
        <span className="text-xs text-[#666]">vid {vid}</span>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm italic">
          Default alignment
          <select
            className="ml-2 min-w-[14rem] border border-[#888] bg-white px-2 py-1"
            value={alignmentSource}
            onChange={(e) => onSourceChange(e.target.value)}
          >
            {(sources.length
              ? sources
              : [
                  { id: "aqua", displayName: "Aqua alignment (default)" },
                  { id: "bespoke", displayName: "Aqua alignment (bespoke)" },
                ]
            ).map((s) => (
              <option key={s.id} value={s.id}>
                {s.displayName}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1 text-sm">
          <input
            type="checkbox"
            checked={showDiff}
            onChange={(e) => setShowDiff(e.target.checked)}
          />
          Show diff vs baseline
        </label>
        {fromSession && (
          <span className="text-xs text-[#666]">Using your saved session edits</span>
        )}
        {loading && <span className="text-xs text-[#666]">Loading…</span>}
      </div>

      <p className="text-sm italic text-[#444]">
        Under each Latin word, enter Greek word indices (comma-separated). Blue
        lines show current links
        {showDiff ? "; red dashed lines were removed from the baseline" : ""}.
      </p>

      {session && (
        <>
          <AlignmentCanvas
            greek={greek}
            latinEntries={latinEntries}
            edits={edits}
            onEdit={(latinIndex, value) =>
              setEdits((prev) => ({ ...prev, [latinIndex]: value }))
            }
            diffRemoved={showDiff ? liveDiff?.removed : []}
          />

          {showDiff && liveDiff && (
            <div className="rounded border border-[#888] bg-white p-3 text-sm">
              <h2 className="mb-1 text-sm italic">Diff vs {alignmentSource} baseline</h2>
              <p>
                Unchanged: {liveDiff.unchanged} · Added: {liveDiff.added.length} ·
                Removed: {liveDiff.removed.length}
              </p>
              {liveDiff.added.length > 0 && (
                <p className="mt-1 text-[#0066CC]">
                  Added:{" "}
                  {liveDiff.added
                    .map((a) => `L${a.latinIndex}→G${a.greekIdx}`)
                    .join(", ")}
                </p>
              )}
              {liveDiff.removed.length > 0 && (
                <p className="mt-1 text-[#cc0000]">
                  Removed:{" "}
                  {liveDiff.removed
                    .map((a) => `L${a.latinIndex}→G${a.greekIdx}`)
                    .join(", ")}
                </p>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void save()}
              disabled={loading}
              className="rounded border border-black bg-[#C1FCC1] px-4 py-2 text-sm"
            >
              Save session alignment
            </button>
            <button
              type="button"
              onClick={resetToBaseline}
              className="rounded border border-black bg-[#FAD780] px-3 py-2 text-sm"
            >
              Restore default indices
            </button>
            <button
              type="button"
              onClick={clearLinks}
              className="rounded border border-black bg-white px-3 py-2 text-sm"
            >
              Clear links
            </button>
            <button
              type="button"
              onClick={() => setShowJson((v) => !v)}
              className="rounded border border-black bg-white px-3 py-2 text-sm"
            >
              {showJson ? "Hide" : "Show"} JSON
            </button>
            {status && <span className="text-sm text-[#444]">{status}</span>}
          </div>

          {showJson && (
            <textarea
              className="w-full min-h-[8rem] border border-[#888] p-2 font-mono text-xs"
              readOnly
              value={JSON.stringify(
                {
                  ...(typeof alignmentJson === "object" && alignmentJson
                    ? alignmentJson
                    : {}),
                  list: latinEntries.map((e) => ({
                    latin: e.latinWord,
                    pairs: (edits[e.latinIndex] ?? "")
                      .split(",")
                      .map((p) => p.trim())
                      .filter(Boolean)
                      .map((idx) => {
                        const n = Number(idx);
                        return [n, greek[n] ?? ""];
                      }),
                  })),
                },
                null,
                2,
              )}
            />
          )}
        </>
      )}
    </div>
  );
}
