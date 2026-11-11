"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AlignmentCanvas,
  type LatinAlignEntry,
} from "@/components/AlignmentCanvas";
import {
  bookCompletion,
  chapterCompletion,
  nextVerseRef,
  ntCompletion,
  progressColor,
  vidFor,
} from "@/lib/progress";
import { NT_BOOKS } from "@/lib/verse_data";

type Session = { id: number; label: string | null; status: string };
type SourceMeta = { id: string; displayName: string; filename: string; isDefault?: boolean };
type DiffResult = {
  added: { latinIndex: number; greekIdx: number }[];
  removed: { latinIndex: number; greekIdx: number }[];
  unchanged: number;
};

const SOURCE_PREF_KEY = "cntr_align_source";
const AUTOSAVE_MS = 300;

function editsFromEntries(entries: LatinAlignEntry[]) {
  const next: Record<number, string> = {};
  for (const entry of entries) {
    next[entry.latinIndex] = entry.pairs.map((p) => p.greekIdx).join(",");
  }
  return next;
}

function parseField(raw: string, greekCount: number) {
  const idxs: number[] = [];
  let invalid = false;
  for (const part of raw.split(",")) {
    const t = part.trim();
    if (t === "") continue;
    const n = Number(t);
    if (!Number.isInteger(n) || n < 0 || n >= greekCount) {
      invalid = true;
      continue;
    }
    idxs.push(n);
  }
  return { idxs: [...new Set(idxs)].sort((a, b) => a - b), invalid };
}

/** True when every non-empty field parses cleanly (no invalid tokens). */
function editsAreWellFormed(
  entries: LatinAlignEntry[],
  edits: Record<number, string>,
  greekCount: number,
) {
  for (const entry of entries) {
    const raw = edits[entry.latinIndex] ?? "";
    if (raw.trim() === "") continue;
    if (parseField(raw, greekCount).invalid) return false;
  }
  return true;
}

function pairsFromEdits(
  entries: LatinAlignEntry[],
  edits: Record<number, string>,
  greekCount: number,
) {
  const pairs: { sourceWordIndex: number; targetWordIndex: number }[] = [];
  for (const entry of entries) {
    const raw = edits[entry.latinIndex] ?? "";
    const { idxs, invalid } = parseField(raw, greekCount);
    if (invalid) continue;
    for (const idx of idxs) {
      pairs.push({
        sourceWordIndex: entry.latinIndex,
        targetWordIndex: idx,
      });
    }
  }
  return pairs;
}

function ProgressBar({ label, pct, detail }: { label: string; pct: number; detail: string }) {
  const color = progressColor(pct);
  return (
    <div className="min-w-[10rem] flex-1">
      <div className="mb-0.5 flex justify-between text-xs">
        <span className="italic">{label}</span>
        <span>{Math.round(pct * 100)}% · {detail}</span>
      </div>
      <div className="h-2 overflow-hidden rounded border border-[#888] bg-[#eee]">
        <div
          className="h-full transition-[width] duration-300"
          style={{ width: `${Math.round(pct * 100)}%`, background: color }}
        />
      </div>
    </div>
  );
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
  const [saving, setSaving] = useState(false);
  const [completedVids, setCompletedVids] = useState<Set<string>>(new Set());
  const [dirty, setDirty] = useState(false);

  const submitBtnRef = useRef<HTMLButtonElement>(null);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editsRef = useRef(edits);
  const latinRef = useRef(latinEntries);
  const greekRef = useRef(greek);
  const sessionRef = useRef(session);
  const vidRef = useRef("");

  editsRef.current = edits;
  latinRef.current = latinEntries;
  greekRef.current = greek;
  sessionRef.current = session;

  const book = NT_BOOKS[bookIdx];
  const vid = useMemo(
    () => vidFor(book.num, chapter, verse),
    [book.num, chapter, verse],
  );
  vidRef.current = vid;

  const completed = completedVids;

  const chapterProg = useMemo(
    () =>
      chapterCompletion(
        completed,
        book.num,
        chapter,
        book.verseCounts[chapter - 1] ?? 0,
      ),
    [book.num, book.verseCounts, chapter, completed],
  );
  const bookProg = useMemo(
    () => bookCompletion(completed, bookIdx),
    [bookIdx, completed],
  );
  const ntProg = useMemo(() => ntCompletion(completed), [completed]);

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
    if (!res.ok) return [];
    const data = await res.json();
    const list: Session[] = data.sessions ?? [];
    setSessions(list);
    return list;
  }, []);

  const refreshProgress = useCallback(async (sessionId: number) => {
    const res = await fetch(`/api/sessions/${sessionId}/progress`);
    if (!res.ok) return;
    const data = await res.json();
    setCompletedVids(new Set(data.submittedVids ?? []));
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
    await refreshProgress(data.session.id);
    return data.session as Session;
  }, [refreshProgress, refreshSessions]);

  useEffect(() => {
    void (async () => {
      const list = await refreshSessions();
      const open = list.find((s) => s.status === "open") ?? null;
      setSession((prev) => {
        if (prev && list.some((s) => s.id === prev.id)) return prev;
        return open;
      });
      if (!open) await createSession();
      else await refreshProgress(open.id);
    })();
  }, [createSession, refreshProgress, refreshSessions]);

  useEffect(() => {
    if (session) void refreshProgress(session.id);
  }, [session, refreshProgress]);

  const loadVerse = useCallback(
    async (sess: Session | null, source: string, withDiff: boolean) => {
      if (!sess) return;
      setLoading(true);
      setStatus("");
      setDirty(false);
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

  const persistAlignment = useCallback(
    async (opts: { submit?: boolean; silent?: boolean } = {}) => {
      const sess = sessionRef.current;
      if (!sess) return false;
      const entries = latinRef.current;
      const g = greekRef.current;
      const e = editsRef.current;
      if (!editsAreWellFormed(entries, e, g.length)) {
        if (!opts.silent) setStatus("Fix invalid indices before saving");
        return false;
      }
      const pairs = pairsFromEdits(entries, e, g.length);
      setSaving(true);
      try {
        const res = await fetch(`/api/verses/${vidRef.current}/alignment`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: sess.id,
            pairs,
            submit: Boolean(opts.submit),
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          if (!opts.silent) setStatus(data.error ?? "Save failed");
          return false;
        }
        setDirty(false);
        if (opts.submit) {
          setCompletedVids((prev) => new Set(prev).add(vidRef.current));
          setStatus(`Submitted ${vidRef.current}`);
          await refreshProgress(sess.id);
        } else if (!opts.silent) {
          setStatus(`Autosaved ${data.saved} links`);
        } else {
          setStatus(`Autosaved`);
        }
        return true;
      } finally {
        setSaving(false);
      }
    },
    [refreshProgress],
  );

  // Debounced autosave on well-formed edits
  useEffect(() => {
    if (!dirty || !session || loading) return;
    if (!editsAreWellFormed(latinEntries, edits, greek.length)) return;
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => {
      void persistAlignment({ silent: true });
    }, AUTOSAVE_MS);
    return () => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    };
  }, [dirty, edits, greek.length, latinEntries, loading, persistAlignment, session]);

  function onSourceChange(id: string) {
    setAlignmentSource(id);
    try {
      localStorage.setItem(SOURCE_PREF_KEY, id);
    } catch {
      /* ignore */
    }
  }

  function onEdit(latinIndex: number, value: string) {
    setEdits((prev) => ({ ...prev, [latinIndex]: value }));
    setDirty(true);
  }

  async function submitAndProceed() {
    const ok = await persistAlignment({ submit: true });
    if (!ok) return;
    const next = nextVerseRef(bookIdx, chapter, verse);
    if (!next) {
      setStatus("Submitted — end of New Testament");
      return;
    }
    setBookIdx(next.bookIdx);
    setChapter(next.chapter);
    setVerse(next.verse);
  }

  function resetToBaseline() {
    setEdits({ ...baselineEdits });
    setDirty(true);
    setStatus("Restored default indices (will autosave)");
  }

  function clearLinks() {
    const next: Record<number, string> = {};
    for (const entry of latinEntries) next[entry.latinIndex] = "";
    setEdits(next);
    setDirty(true);
  }

  async function exportSession(s: Session) {
    setStatus(`Exporting session #${s.id}…`);
    const res = await fetch(`/api/sessions/${s.id}/export`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setStatus(err.error ?? "Export failed");
      return;
    }
    const data = await res.json();
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cntr-alignment-session-${s.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setStatus(`Exported session #${s.id}`);
  }

  const liveDiff = useMemo(() => {
    if (!showDiff) return null;
    if (diff && fromSession) return diff;
    const key = (s: number, t: number) => `${s}:${t}`;
    const base = new Set<string>();
    const cur = new Set<string>();
    for (const e of baselineEntries) {
      for (const p of e.pairs) base.add(key(e.latinIndex, p.greekIdx));
    }
    for (const e of latinEntries) {
      const raw = edits[e.latinIndex] ?? "";
      parseField(raw, greek.length).idxs.forEach((n) =>
        cur.add(key(e.latinIndex, n)),
      );
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
  }, [baselineEntries, diff, edits, fromSession, greek.length, latinEntries, showDiff]);

  const chapters = book.verseCounts.length;
  const verseCount = book.verseCounts[chapter - 1] ?? 1;

  return (
    <div className="flex w-full min-w-0 flex-col gap-3">
      {/* —— Progress (always above the workspace) —— */}
      <section className="rounded border border-[#c9a86a] bg-[#fff8e7] p-3">
        <h2 className="mb-2 text-sm italic text-[#523d02]">Progress</h2>
        <div className="flex flex-wrap gap-3">
          <ProgressBar
            label="Chapter verses"
            pct={chapterProg.pct}
            detail={`${chapterProg.done}/${chapterProg.total}`}
          />
          <ProgressBar
            label="Book chapters"
            pct={bookProg.pct}
            detail={`${bookProg.done}/${bookProg.total}`}
          />
          <ProgressBar
            label="NT books"
            pct={ntProg.pct}
            detail={`${ntProg.done}/${ntProg.total}`}
          />
        </div>
      </section>

      {/* —— Session / verse controls —— */}
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm italic">
          Session
          <select
            className="ml-2 border border-[#888] bg-white px-2 py-1"
            value={session?.id ?? ""}
            onChange={(e) => {
              const id = Number(e.target.value);
              const next = sessions.find((s) => s.id === id) ?? null;
              setSession(next);
              if (next) void refreshProgress(next.id);
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
        {sessions.map((s) => (
          <button
            key={`export-${s.id}`}
            type="button"
            onClick={() => void exportSession(s)}
            className="rounded border border-black bg-white px-2 py-1 text-xs"
            title={`Export session #${s.id} as JSON`}
          >
            Export #{s.id}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          className="border border-[#888] px-2 py-1"
          style={{ background: progressColor(bookProg.pct) }}
          value={bookIdx}
          onChange={(e) => {
            setBookIdx(Number(e.target.value));
            setChapter(1);
            setVerse(1);
          }}
        >
          {NT_BOOKS.map((b, i) => {
            const p = bookCompletion(completed, i).pct;
            return (
              <option key={b.num} value={i} style={{ background: progressColor(p) }}>
                {b.name}
              </option>
            );
          })}
        </select>
        <select
          className="border border-[#888] px-2 py-1"
          style={{ background: progressColor(chapterProg.pct) }}
          value={chapter}
          onChange={(e) => {
            setChapter(Number(e.target.value));
            setVerse(1);
          }}
        >
          {Array.from({ length: chapters }, (_, i) => {
            const c = i + 1;
            const p = chapterCompletion(
              completed,
              book.num,
              c,
              book.verseCounts[c - 1] ?? 0,
            ).pct;
            return (
              <option key={c} value={c} style={{ background: progressColor(p) }}>
                {c}
              </option>
            );
          })}
        </select>
        <span>:</span>
        <select
          className="border border-[#888] px-2 py-1"
          style={{
            background: progressColor(
              completed.has(vidFor(book.num, chapter, verse)) ? 1 : 0,
            ),
          }}
          value={verse}
          onChange={(e) => setVerse(Number(e.target.value))}
        >
          {Array.from({ length: verseCount }, (_, i) => {
            const v = i + 1;
            const done = completed.has(vidFor(book.num, chapter, v));
            return (
              <option
                key={v}
                value={v}
                style={{ background: progressColor(done ? 1 : 0) }}
              >
                {v}
              </option>
            );
          })}
        </select>
        <span className="text-xs text-[#666]">
          vid {vid}
          {completed.has(vid) ? " · submitted" : ""}
        </span>
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
        {(loading || saving) && (
          <span className="text-xs text-[#666]">
            {loading ? "Loading…" : "Saving…"}
          </span>
        )}
      </div>

      <p className="text-sm italic text-[#444]">
        Edits autosave after 300ms when indices are valid. Tab to{" "}
        <strong>Submit and Proceed</strong> to mark the verse complete and
        advance.
        {showDiff ? " Red dashed lines were removed from the baseline." : ""}
      </p>

      {/* Full-bleed strip: uses page edges; only this region scrolls horizontally */}
      {session && (
        <section className="-mx-4 w-[calc(100%+2rem)] min-w-0">
          <AlignmentCanvas
            greek={greek}
            latinEntries={latinEntries}
            edits={edits}
            onEdit={onEdit}
            diffRemoved={showDiff ? liveDiff?.removed : []}
            onRequestSubmit={() => submitBtnRef.current?.focus()}
          />

          {showDiff && liveDiff && (
            <div className="mt-3 rounded border border-[#888] bg-white p-3 text-sm">
              <h2 className="mb-1 text-sm italic">Diff vs {alignmentSource} baseline</h2>
              <p>
                Unchanged: {liveDiff.unchanged} · Added: {liveDiff.added.length} ·
                Removed: {liveDiff.removed.length}
              </p>
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              ref={submitBtnRef}
              type="button"
              onClick={() => void submitAndProceed()}
              disabled={loading || saving}
              className="rounded border border-black bg-[#C1FCC1] px-4 py-2 text-sm font-medium"
            >
              Submit and Proceed
            </button>
            <button
              type="button"
              onClick={() => void persistAlignment({ submit: false })}
              disabled={loading || saving}
              className="rounded border border-black bg-white px-3 py-2 text-sm"
            >
              Save draft
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
              className="mt-3 w-full min-h-[8rem] border border-[#888] p-2 font-mono text-xs"
              readOnly
              value={JSON.stringify(
                {
                  ...(typeof alignmentJson === "object" && alignmentJson
                    ? alignmentJson
                    : {}),
                  list: latinEntries.map((e) => ({
                    latin: e.latinWord,
                    pairs: parseField(edits[e.latinIndex] ?? "", greek.length).idxs.map(
                      (n) => [n, greek[n] ?? ""],
                    ),
                  })),
                },
                null,
                2,
              )}
            />
          )}
        </section>
      )}
    </div>
  );
}
