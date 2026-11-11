"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { NT_BOOKS } from "@/lib/verse_data";

type LatinEntry = {
  latinWord: string;
  latinIndex: number;
  pairs: { greekIdx: number; greekWord: string; confidence: number }[];
};

type Session = { id: number; label: string | null; status: string };

function pad3(n: number) {
  return String(n).padStart(3, "0");
}

function vidFor(bookNum: number, chapter: number, verse: number) {
  return `${bookNum}${pad3(chapter)}${pad3(verse)}`;
}

export function AlignmentWorkspace() {
  const [bookIdx, setBookIdx] = useState(0);
  const [chapter, setChapter] = useState(1);
  const [verse, setVerse] = useState(1);
  const [session, setSession] = useState<Session | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [greek, setGreek] = useState<string[]>([]);
  const [latinEntries, setLatinEntries] = useState<LatinEntry[]>([]);
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  const book = NT_BOOKS[bookIdx];
  const vid = useMemo(
    () => vidFor(book.num, chapter, verse),
    [book.num, chapter, verse],
  );

  const refreshSessions = useCallback(async () => {
    const res = await fetch("/api/sessions");
    if (!res.ok) return;
    const data = await res.json();
    setSessions(data.sessions ?? []);
  }, []);

  useEffect(() => {
    refreshSessions();
  }, [refreshSessions]);

  const loadVerse = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    setStatus("");
    try {
      const res = await fetch(
        `/api/verses/${vid}/alignment?sessionId=${session.id}&source=lat&target=grc`,
      );
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
      const next: Record<number, string> = {};
      for (const entry of data.latinEntries ?? []) {
        next[entry.latinIndex] = entry.pairs
          .map((p: { greekIdx: number }) => p.greekIdx)
          .join(",");
      }
      setEdits(next);
    } finally {
      setLoading(false);
    }
  }, [session, vid]);

  useEffect(() => {
    if (session) loadVerse();
  }, [session, loadVerse]);

  async function createSession() {
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
      return;
    }
    setSession(data.session);
    await refreshSessions();
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
  }

  const chapters = book.verseCounts.length;
  const verseCount = book.verseCounts[chapter - 1] ?? 1;
  const alignedGreek = new Set(
    Object.values(edits).flatMap((v) =>
      v
        .split(",")
        .map((p) => Number(p.trim()))
        .filter((n) => Number.isInteger(n)),
    ),
  );

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
          onClick={createSession}
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

      {!session && (
        <p className="text-sm italic text-[#666]">
          Create or select a session to load verse alignments.
        </p>
      )}

      {session && (
        <>
          <section>
            <h2 className="mb-1 text-sm italic">Greek (CNTR base)</h2>
            <div className="flex flex-wrap gap-2 rounded border border-[#888] bg-[#EAC17D] p-3">
              {greek.map((w, i) => (
                <div
                  key={i}
                  className={`min-w-[3rem] border border-[#c9a86a] bg-[#EAC17D] px-2 py-1 text-center ${
                    alignedGreek.has(i) ? "" : "opacity-60 border-dashed"
                  }`}
                >
                  <div className="text-[0.7rem] text-[#555]">{i}</div>
                  <div>{w}</div>
                </div>
              ))}
              {!greek.length && !loading && (
                <span className="text-sm text-[#666]">No base words loaded.</span>
              )}
            </div>
          </section>

          <section>
            <h2 className="mb-1 text-sm italic">
              Latin (Stuttgart) — enter Greek indices under each word
            </h2>
            <div className="flex flex-wrap gap-2 overflow-x-auto rounded border border-[#888] bg-[#fafafa] p-3">
              {latinEntries.map((entry) => (
                <div
                  key={entry.latinIndex}
                  className="flex min-w-[3.5rem] flex-col items-center border border-[#aaa] bg-white px-2 py-2"
                >
                  <div className="mb-2 font-serif">{entry.latinWord}</div>
                  <input
                    className="w-12 border border-[#666] text-center text-sm"
                    value={edits[entry.latinIndex] ?? ""}
                    onChange={(e) =>
                      setEdits((prev) => ({
                        ...prev,
                        [entry.latinIndex]: e.target.value,
                      }))
                    }
                    placeholder="idx"
                    inputMode="numeric"
                  />
                </div>
              ))}
            </div>
          </section>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={save}
              disabled={loading}
              className="rounded border border-black bg-[#C1FCC1] px-4 py-2 text-sm"
            >
              Save session alignment
            </button>
            {status && <span className="text-sm text-[#444]">{status}</span>}
          </div>
        </>
      )}
    </div>
  );
}
