"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { NT_BOOKS } from "@/lib/verse_data";

type Manuscript = {
  id: number;
  siglum: string;
  name: string | null;
  isBase: boolean;
};

function pad3(n: number) {
  return String(n).padStart(3, "0");
}

export function VariantBrowser() {
  const [bookIdx, setBookIdx] = useState(0);
  const [chapter, setChapter] = useState(1);
  const [verse, setVerse] = useState(1);
  const [manuscripts, setManuscripts] = useState<Manuscript[]>([]);
  const [siglum, setSiglum] = useState("");
  const [base, setBase] = useState<string[]>([]);
  const [reconstructed, setReconstructed] = useState<string[]>([]);
  const [ops, setOps] = useState<unknown[]>([]);
  const [status, setStatus] = useState("");

  const book = NT_BOOKS[bookIdx];
  const vid = useMemo(
    () => `${book.num}${pad3(chapter)}${pad3(verse)}`,
    [book.num, chapter, verse],
  );

  const load = useCallback(async () => {
    setStatus("");
    const listRes = await fetch(`/api/verses/${vid}/variants?language=grc`);
    if (!listRes.ok) {
      const err = await listRes.json().catch(() => ({}));
      setStatus(err.error ?? "Failed to load");
      return;
    }
    const listData = await listRes.json();
    setBase(listData.base ?? []);
    setManuscripts(listData.manuscripts ?? []);
    const nextSiglum =
      siglum ||
      listData.manuscripts?.find((m: Manuscript) => m.isBase)?.siglum ||
      listData.manuscripts?.[0]?.siglum ||
      "";
    if (nextSiglum !== siglum) setSiglum(nextSiglum);

    if (!nextSiglum) {
      setReconstructed(listData.base ?? []);
      setOps([]);
      return;
    }

    const res = await fetch(
      `/api/verses/${vid}/variants?language=grc&manuscript=${encodeURIComponent(nextSiglum)}`,
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setStatus(err.error ?? "Failed to load manuscript");
      return;
    }
    const data = await res.json();
    setBase(data.base ?? []);
    setReconstructed(data.reconstructed ?? []);
    setOps(data.ops ?? []);
  }, [vid, siglum]);

  useEffect(() => {
    void load();
  }, [load]);

  const chapters = book.verseCounts.length;
  const verseCount = book.verseCounts[chapter - 1] ?? 1;

  return (
    <div className="space-y-4">
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
        <select
          className="border border-[#888] bg-white px-2 py-1"
          value={siglum}
          onChange={(e) => setSiglum(e.target.value)}
        >
          <option value="">Manuscript…</option>
          {manuscripts.map((m) => (
            <option key={m.id} value={m.siglum}>
              {m.siglum}
              {m.isBase ? " (base)" : ""}
            </option>
          ))}
        </select>
      </div>

      {status && <p className="text-sm text-red-700">{status}</p>}

      <section>
        <h2 className="mb-1 text-sm italic">Base (CNTR Classic)</h2>
        <p className="rounded border border-[#888] bg-[#EAC17D] p-3 font-serif leading-relaxed">
          {base.join(" ") || "—"}
        </p>
      </section>

      <section>
        <h2 className="mb-1 text-sm italic">
          Reconstructed manuscript{siglum ? ` (${siglum})` : ""}
        </h2>
        <p className="rounded border border-[#888] bg-white p-3 font-serif leading-relaxed">
          {reconstructed.join(" ") || "—"}
        </p>
      </section>

      <section>
        <h2 className="mb-1 text-sm italic">Myers ops</h2>
        <pre className="overflow-x-auto rounded border border-[#888] bg-[#f8f8f8] p-3 text-xs">
          {JSON.stringify(ops, null, 2)}
        </pre>
      </section>
    </div>
  );
}
