"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

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

type Line = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  invalid?: boolean;
};

function parseIdxs(raw: string, greekCount: number) {
  const idxs: number[] = [];
  let invalid = false;
  raw.split(",").forEach((part) => {
    const t = part.trim();
    if (t === "") return;
    const n = Number(t);
    if (!Number.isInteger(n) || n < 0 || n >= greekCount) {
      invalid = true;
      return;
    }
    idxs.push(n);
  });
  return { idxs: [...new Set(idxs)].sort((a, b) => a - b), invalid };
}

type Props = {
  greek: string[];
  latinEntries: LatinAlignEntry[];
  edits: Record<number, string>;
  onEdit: (latinIndex: number, value: string) => void;
  /** When set, draw extra dashed lines for baseline-only (removed) links */
  diffRemoved?: { latinIndex: number; greekIdx: number }[];
  editable?: boolean;
};

export function AlignmentCanvas({
  greek,
  latinEntries,
  edits,
  onEdit,
  diffRemoved = [],
  editable = true,
}: Props) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const greekRefs = useRef<(HTMLDivElement | null)[]>([]);
  const latinRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [lines, setLines] = useState<Line[]>([]);

  const alignedGreek = useMemo(() => {
    const set = new Set<number>();
    for (const entry of latinEntries) {
      const raw = edits[entry.latinIndex] ?? entry.pairs.map((p) => p.greekIdx).join(",");
      parseIdxs(raw, greek.length).idxs.forEach((i) => set.add(i));
    }
    return set;
  }, [edits, greek.length, latinEntries]);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const crect = canvas.getBoundingClientRect();
    const next: Line[] = [];

    latinEntries.forEach((entry, li) => {
      const latinEl = latinRefs.current[li];
      if (!latinEl) return;
      const raw =
        edits[entry.latinIndex] ??
        entry.pairs.map((p) => p.greekIdx).join(",");
      const { idxs, invalid } = parseIdxs(raw, greek.length);
      const lrect = latinEl.getBoundingClientRect();
      const x1 = lrect.left + lrect.width / 2 - crect.left;
      const y1 = lrect.top - crect.top;

      idxs.forEach((gIdx) => {
        const gEl = greekRefs.current[gIdx]?.querySelector(".greek-word");
        if (!gEl) return;
        const grect = gEl.getBoundingClientRect();
        next.push({
          x1,
          y1,
          x2: grect.left + grect.width / 2 - crect.left,
          y2: grect.bottom - crect.top,
          invalid,
        });
      });
    });

    // Removed baseline links (dashed red)
    for (const rem of diffRemoved) {
      const li = latinEntries.findIndex((e) => e.latinIndex === rem.latinIndex);
      const lEl = latinRefs.current[li];
      const gEl = greekRefs.current[rem.greekIdx]?.querySelector(".greek-word");
      if (!lEl || !gEl) continue;
      const lrect = lEl.getBoundingClientRect();
      const grect = gEl.getBoundingClientRect();
      next.push({
        x1: lrect.left + lrect.width / 2 - crect.left,
        y1: lrect.top - crect.top,
        x2: grect.left + grect.width / 2 - crect.left,
        y2: grect.bottom - crect.top,
        invalid: true,
      });
    }

    setLines(next);
  }, [diffRemoved, edits, greek.length, latinEntries]);

  useLayoutEffect(() => {
    redraw();
  }, [redraw]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => redraw());
    ro.observe(canvas);
    window.addEventListener("scroll", redraw, true);
    return () => {
      ro.disconnect();
      window.removeEventListener("scroll", redraw, true);
    };
  }, [redraw]);

  return (
    <div
      ref={canvasRef}
      className="alignment-canvas relative min-h-[10rem] w-full min-w-max overflow-x-auto border border-[#888] bg-[#fafafa] px-2 py-4"
    >
      <svg
        className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
        aria-hidden
      >
        {lines.map((ln, i) => (
          <line
            key={i}
            x1={ln.x1}
            y1={ln.y1}
            x2={ln.x2}
            y2={ln.y2}
            stroke={ln.invalid ? "#cc0000" : "#0066CC"}
            strokeWidth={2}
            strokeDasharray={ln.invalid ? "4 3" : undefined}
          />
        ))}
      </svg>

      <div className="relative z-[1] flex flex-col gap-12">
        <div className="greek-row flex flex-nowrap items-end gap-1">
          {greek.map((w, i) => (
            <div
              key={i}
              ref={(el) => {
                greekRefs.current[i] = el;
              }}
              className="flex shrink-0 flex-col items-center"
            >
              <div className="mb-0.5 text-[0.75rem] text-[#555]">{i}</div>
              <div
                className={`greek-word min-w-[3rem] border border-[#c9a86a] bg-[#EAC17D] px-1.5 py-1 text-center font-serif ${
                  alignedGreek.has(i) ? "" : "border-dashed opacity-75"
                }`}
              >
                {w}
              </div>
            </div>
          ))}
        </div>

        <div className="latin-row flex flex-nowrap items-start gap-1">
          {latinEntries.map((entry, li) => {
            const raw =
              edits[entry.latinIndex] ??
              entry.pairs.map((p) => p.greekIdx).join(",");
            const { invalid } = parseIdxs(raw, greek.length);
            return (
              <div
                key={entry.latinIndex}
                ref={(el) => {
                  latinRefs.current[li] = el;
                }}
                className="flex shrink-0 flex-col items-center border border-[#aaa] bg-[#fafafa] px-1.5 py-1"
              >
                <div className="min-w-[3rem] px-1 pb-2 text-center font-serif">
                  {entry.latinWord}
                </div>
                {editable ? (
                  <input
                    className={`w-8 border text-center text-xs ${
                      invalid
                        ? "border-[#cc0000] bg-[#fff0f0]"
                        : "border-[#666] bg-white"
                    }`}
                    value={edits[entry.latinIndex] ?? raw}
                    onChange={(e) => onEdit(entry.latinIndex, e.target.value)}
                    placeholder="idx"
                    inputMode="numeric"
                    title={`Greek index for "${entry.latinWord}"`}
                  />
                ) : (
                  <div className="text-[0.7rem] text-[#666]">
                    {entry.pairs.length
                      ? entry.pairs
                          .map((p) => `${p.greekIdx} · ${p.confidence.toFixed(2)}`)
                          .join(", ")
                      : "—"}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
