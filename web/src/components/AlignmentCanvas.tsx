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

const MIN_GAP = 4;
/** Cap so a short row does not become absurdly sparse when matching the other. */
const MAX_GAP = 28;

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

function measureRow(rowEl: HTMLElement) {
  const children = [...rowEl.children] as HTMLElement[];
  const tokenWidth = children.reduce((sum, child) => sum + child.offsetWidth, 0);
  const contentWidth =
    tokenWidth + Math.max(0, children.length - 1) * MIN_GAP;
  return { tokenWidth, contentWidth, count: children.length };
}

/**
 * Stretch each row toward a shared target width so Greek and Latin line up,
 * but clamp gap so neither language becomes overly sparse.
 */
function fitRow(
  rowEl: HTMLElement,
  row: ReturnType<typeof measureRow>,
  targetWidth: number,
) {
  if (row.count <= 1) {
    rowEl.style.width = `${targetWidth}px`;
    rowEl.style.gap = `${MIN_GAP}px`;
    rowEl.style.justifyContent = "center";
    return;
  }
  if (row.contentWidth >= targetWidth - 0.5) {
    rowEl.style.width = `${row.contentWidth}px`;
    rowEl.style.gap = `${MIN_GAP}px`;
    rowEl.style.justifyContent = "flex-start";
    return;
  }
  const idealGap = (targetWidth - row.tokenWidth) / (row.count - 1);
  const gap = Math.min(MAX_GAP, Math.max(MIN_GAP, idealGap));
  const usedWidth = row.tokenWidth + gap * (row.count - 1);
  rowEl.style.width = `${usedWidth}px`;
  rowEl.style.gap = `${gap}px`;
  rowEl.style.justifyContent = "flex-start";
}

type Props = {
  greek: string[];
  latinEntries: LatinAlignEntry[];
  edits: Record<number, string>;
  onEdit: (latinIndex: number, value: string) => void;
  diffRemoved?: { latinIndex: number; greekIdx: number }[];
  editable?: boolean;
  onRequestSubmit?: () => void;
};

export function AlignmentCanvas({
  greek,
  latinEntries,
  edits,
  onEdit,
  diffRemoved = [],
  editable = true,
  onRequestSubmit,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const greekRowRef = useRef<HTMLDivElement>(null);
  const latinRowRef = useRef<HTMLDivElement>(null);
  const greekRefs = useRef<(HTMLDivElement | null)[]>([]);
  const latinRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [svgSize, setSvgSize] = useState({ w: 0, h: 0 });

  const alignedGreek = useMemo(() => {
    const set = new Set<number>();
    for (const entry of latinEntries) {
      const raw =
        edits[entry.latinIndex] ?? entry.pairs.map((p) => p.greekIdx).join(",");
      parseIdxs(raw, greek.length).idxs.forEach((i) => set.add(i));
    }
    return set;
  }, [edits, greek.length, latinEntries]);

  const layoutRows = useCallback(() => {
    const scroll = scrollRef.current;
    const greekRow = greekRowRef.current;
    const latinRow = latinRowRef.current;
    if (!scroll || !greekRow || !latinRow) return;

    // Reset to natural size before measuring
    greekRow.style.width = "";
    greekRow.style.gap = `${MIN_GAP}px`;
    greekRow.style.justifyContent = "flex-start";
    greekRow.style.marginBottom = "";
    latinRow.style.width = "";
    latinRow.style.gap = `${MIN_GAP}px`;
    latinRow.style.justifyContent = "flex-start";

    void greekRow.offsetHeight;

    const g = measureRow(greekRow);
    const l = measureRow(latinRow);
    // Prefer matching the denser language; only grow to the viewport when both fit.
    // That delays horizontal scroll and keeps the shorter row from overspreading.
    const pairWidth = Math.max(g.contentWidth, l.contentWidth);
    const viewport = Math.max(0, scroll.clientWidth - 16);
    const targetWidth = Math.max(pairWidth, viewport);

    fitRow(greekRow, g, targetWidth);
    fitRow(latinRow, l, targetWidth);

    const gUsed = greekRow.offsetWidth;
    const lUsed = latinRow.offsetWidth;
    const shared = Math.max(gUsed, lUsed, viewport);
    greekRow.style.width = `${shared}px`;
    latinRow.style.width = `${shared}px`;
    greekRow.style.marginBottom = `${Math.max(52, Math.min(88, shared * 0.04))}px`;
  }, []);

  const redraw = useCallback(() => {
    layoutRows();

    const canvas = canvasRef.current;
    if (!canvas) return;
    const crect = canvas.getBoundingClientRect();
    setSvgSize({
      w: Math.max(canvas.scrollWidth, crect.width),
      h: Math.max(canvas.scrollHeight, crect.height),
    });

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
  }, [diffRemoved, edits, greek.length, latinEntries, layoutRows]);

  useLayoutEffect(() => {
    redraw();
  }, [redraw]);

  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const ro = new ResizeObserver(() => redraw());
    ro.observe(scroll);
    scroll.addEventListener("scroll", redraw, { passive: true });
    window.addEventListener("resize", redraw);
    return () => {
      ro.disconnect();
      scroll.removeEventListener("scroll", redraw);
      window.removeEventListener("resize", redraw);
    };
  }, [redraw]);

  return (
    <div className="alignment-workspace w-full min-w-0">
      <div
        ref={scrollRef}
        className="w-full overflow-x-auto overflow-y-hidden border-y border-[#888] bg-[#fafafa]"
      >
        <div
          ref={canvasRef}
          className="relative box-border px-3 py-4"
          style={{ minWidth: "100%", width: "max-content" }}
        >
          <svg
            className="pointer-events-none absolute left-0 top-0 overflow-visible"
            width={svgSize.w || "100%"}
            height={svgSize.h || "100%"}
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

          <div className="relative z-[1]">
            <div
              ref={greekRowRef}
              className="greek-row flex flex-nowrap items-end"
              style={{ gap: MIN_GAP }}
            >
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
                    className={`greek-word min-w-[2.75rem] border border-[#c9a86a] bg-[#EAC17D] px-1.5 py-1 text-center font-serif text-[0.95rem] ${
                      alignedGreek.has(i) ? "" : "border-dashed opacity-75"
                    }`}
                  >
                    {w}
                  </div>
                </div>
              ))}
            </div>

            <div
              ref={latinRowRef}
              className="latin-row flex flex-nowrap items-start"
              style={{ gap: MIN_GAP }}
            >
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
                    className="flex shrink-0 flex-col items-center border border-[#aaa] bg-white px-1.5 py-1"
                  >
                    <div className="min-w-[2.75rem] px-0.5 pb-2 text-center font-serif text-[0.95rem]">
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
                        onKeyDown={(e) => {
                          if (
                            e.key === "Tab" &&
                            !e.shiftKey &&
                            li === latinEntries.length - 1 &&
                            onRequestSubmit
                          ) {
                            e.preventDefault();
                            onRequestSubmit();
                          }
                        }}
                        placeholder="idx"
                        inputMode="numeric"
                        title={`Greek index for "${entry.latinWord}"`}
                      />
                    ) : (
                      <div className="text-[0.7rem] text-[#666]">
                        {entry.pairs.length
                          ? entry.pairs
                              .map(
                                (p) =>
                                  `${p.greekIdx} · ${p.confidence.toFixed(2)}`,
                              )
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
      </div>
    </div>
  );
}
