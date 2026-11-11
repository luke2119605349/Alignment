"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
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
const PAD_X = 12;
const DEFAULT_HEIGHT = 280;
const MIN_HEIGHT = 160;

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
    rowEl.style.width = `${Math.max(row.contentWidth, targetWidth)}px`;
    rowEl.style.gap = `${MIN_GAP}px`;
    rowEl.style.justifyContent = "center";
    return rowEl.offsetWidth;
  }
  if (row.contentWidth >= targetWidth - 0.5) {
    rowEl.style.width = `${row.contentWidth}px`;
    rowEl.style.gap = `${MIN_GAP}px`;
    rowEl.style.justifyContent = "flex-start";
    return row.contentWidth;
  }
  const idealGap = (targetWidth - row.tokenWidth) / (row.count - 1);
  const gap = Math.min(MAX_GAP, Math.max(MIN_GAP, idealGap));
  const usedWidth = row.tokenWidth + gap * (row.count - 1);
  rowEl.style.width = `${usedWidth}px`;
  rowEl.style.gap = `${gap}px`;
  rowEl.style.justifyContent = "flex-start";
  return usedWidth;
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

type DragKind = "greek" | "latin";

export function AlignmentCanvas({
  greek,
  latinEntries,
  edits,
  onEdit,
  diffRemoved = [],
  editable = true,
  onRequestSubmit,
}: Props) {
  const shellRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const greekRowRef = useRef<HTMLDivElement>(null);
  const latinRowRef = useRef<HTMLDivElement>(null);
  const greekRefs = useRef<(HTMLDivElement | null)[]>([]);
  const latinRefs = useRef<(HTMLDivElement | null)[]>([]);
  const dragRef = useRef<{
    kind: DragKind;
    startX: number;
    origin: number;
  } | null>(null);
  const resizeRef = useRef<{ startY: number; originH: number } | null>(null);
  const offsetsRef = useRef({ greek: 0, latin: 0 });

  const [lines, setLines] = useState<Line[]>([]);
  const [svgSize, setSvgSize] = useState({ w: 0, h: 0 });
  const [greekOffset, setGreekOffset] = useState(0);
  const [latinOffset, setLatinOffset] = useState(0);
  const [shellHeight, setShellHeight] = useState(DEFAULT_HEIGHT);
  const [needsHScroll, setNeedsHScroll] = useState(false);

  offsetsRef.current = { greek: greekOffset, latin: latinOffset };

  const alignedGreek = useMemo(() => {
    const set = new Set<number>();
    for (const entry of latinEntries) {
      const raw =
        edits[entry.latinIndex] ?? entry.pairs.map((p) => p.greekIdx).join(",");
      parseIdxs(raw, greek.length).idxs.forEach((i) => set.add(i));
    }
    return set;
  }, [edits, greek.length, latinEntries]);

  // Reset row shifts when the verse / token set changes
  useEffect(() => {
    setGreekOffset(0);
    setLatinOffset(0);
  }, [greek, latinEntries]);

  const drawLines = useCallback(() => {
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
  }, [diffRemoved, edits, greek.length, latinEntries]);

  const layoutRows = useCallback(() => {
    const scroll = scrollRef.current;
    const canvas = canvasRef.current;
    const greekRow = greekRowRef.current;
    const latinRow = latinRowRef.current;
    if (!scroll || !canvas || !greekRow || !latinRow) return;

    const { greek: gOff, latin: lOff } = offsetsRef.current;

    // Measure natural packed widths (ignore current translate)
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
    const viewport = Math.max(0, scroll.clientWidth - PAD_X * 2);
    const pairWidth = Math.max(g.contentWidth, l.contentWidth);
    // Grow gaps to fill the viewport only when both rows already fit
    const stretchTarget = pairWidth <= viewport ? viewport : pairWidth;

    const gUsed = fitRow(greekRow, g, stretchTarget);
    const lUsed = fitRow(latinRow, l, stretchTarget);
    const rowSpan = Math.max(gUsed, lUsed);
    greekRow.style.width = `${rowSpan}px`;
    latinRow.style.width = `${rowSpan}px`;
    greekRow.style.marginBottom = `${Math.max(52, Math.min(88, rowSpan * 0.04))}px`;

    const leftPad = Math.max(0, -gOff, -lOff);
    const rightEdge = Math.max(rowSpan + gOff, rowSpan + lOff, rowSpan);
    const contentWidth = leftPad + rightEdge + PAD_X * 2;
    const fits = contentWidth <= scroll.clientWidth + 0.5;

    canvas.style.minWidth = fits ? "100%" : `${Math.ceil(contentWidth)}px`;
    canvas.style.width = fits ? "100%" : `${Math.ceil(contentWidth)}px`;
    canvas.style.paddingLeft = `${PAD_X + leftPad}px`;
    canvas.style.paddingRight = `${PAD_X}px`;

    greekRow.style.transform = `translateX(${gOff}px)`;
    latinRow.style.transform = `translateX(${lOff}px)`;

    setNeedsHScroll(!fits);
  }, []);

  const redraw = useCallback(() => {
    layoutRows();
    drawLines();
  }, [drawLines, layoutRows]);

  useLayoutEffect(() => {
    redraw();
  }, [redraw, greekOffset, latinOffset, shellHeight]);

  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const ro = new ResizeObserver(() => redraw());
    ro.observe(scroll);
    scroll.addEventListener("scroll", drawLines, { passive: true });
    window.addEventListener("resize", redraw);
    return () => {
      ro.disconnect();
      scroll.removeEventListener("scroll", drawLines);
      window.removeEventListener("resize", redraw);
    };
  }, [drawLines, redraw]);

  const onRowPointerDown = (kind: DragKind, e: ReactPointerEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest("input, button, a, textarea, select")) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = {
      kind,
      startX: e.clientX,
      origin: kind === "greek" ? greekOffset : latinOffset,
    };
  };

  const onRowPointerMove = (e: ReactPointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const next = drag.origin + dx;
    if (drag.kind === "greek") setGreekOffset(next);
    else setLatinOffset(next);
  };

  const onRowPointerUp = (e: ReactPointerEvent) => {
    if (!dragRef.current) return;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    dragRef.current = null;
  };

  const onResizePointerDown = (e: ReactPointerEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    resizeRef.current = { startY: e.clientY, originH: shellHeight };
  };

  const onResizePointerMove = (e: ReactPointerEvent) => {
    const r = resizeRef.current;
    if (!r) return;
    const next = Math.max(MIN_HEIGHT, r.originH + (e.clientY - r.startY));
    setShellHeight(next);
  };

  const onResizePointerUp = (e: ReactPointerEvent) => {
    if (!resizeRef.current) return;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    resizeRef.current = null;
  };

  return (
    <div className="alignment-workspace w-full min-w-0">
      <p className="mb-1 px-1 text-[0.7rem] text-[#666]">
        Drag a Greek or Latin row sideways to untangle overlapping links. Resize
        from the bottom edge.
      </p>
      <div
        ref={shellRef}
        className="relative flex w-full flex-col border-y border-[#888] bg-[#fafafa]"
        style={{ height: shellHeight }}
      >
        <div
          ref={scrollRef}
          className={`min-h-0 flex-1 ${
            needsHScroll ? "overflow-x-auto" : "overflow-x-hidden"
          } overflow-y-auto`}
        >
          <div
            ref={canvasRef}
            className="relative box-border py-4"
            style={{ minWidth: "100%" }}
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
                className="greek-row flex cursor-grab flex-nowrap items-end active:cursor-grabbing"
                style={{ gap: MIN_GAP, touchAction: "none" }}
                onPointerDown={(e) => onRowPointerDown("greek", e)}
                onPointerMove={onRowPointerMove}
                onPointerUp={onRowPointerUp}
                onPointerCancel={onRowPointerUp}
                title="Drag to shift Greek words"
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
                className="latin-row flex cursor-grab flex-nowrap items-start active:cursor-grabbing"
                style={{ gap: MIN_GAP, touchAction: "none" }}
                onPointerDown={(e) => onRowPointerDown("latin", e)}
                onPointerMove={onRowPointerMove}
                onPointerUp={onRowPointerUp}
                onPointerCancel={onRowPointerUp}
                title="Drag to shift Latin words"
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
                          className={`w-8 cursor-text border text-center text-xs ${
                            invalid
                              ? "border-[#cc0000] bg-[#fff0f0]"
                              : "border-[#666] bg-white"
                          }`}
                          value={edits[entry.latinIndex] ?? raw}
                          onChange={(e) =>
                            onEdit(entry.latinIndex, e.target.value)
                          }
                          onPointerDown={(e) => e.stopPropagation()}
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

        <div
          className="flex h-3 shrink-0 cursor-ns-resize items-center justify-center border-t border-[#ccc] bg-[#f0ebe0] hover:bg-[#e8e0d0]"
          onPointerDown={onResizePointerDown}
          onPointerMove={onResizePointerMove}
          onPointerUp={onResizePointerUp}
          onPointerCancel={onResizePointerUp}
          title="Drag to resize workspace height"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize alignment workspace"
        >
          <div className="h-0.5 w-10 rounded bg-[#aaa]" />
        </div>
      </div>
    </div>
  );
}
