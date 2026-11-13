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

const MIN_GAP = 6;
/** Soft stretch toward the other row only — never past own content by much. */
const MAX_GAP = 16;
/** Horizontal inset inside the canvas (keeps tokens clear of the shell edge). */
const PAD_X = 36;
/** Extra room past the rightmost/leftmost transformed block so borders aren't clipped. */
const EDGE_SLACK = 48;
/** Shell `border-2` on both sides (Tailwind border-box). */
const SHELL_BORDER_X = 4;
const DEFAULT_HEIGHT = 300;
const MIN_HEIGHT = 180;

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

/** Stable default — a fresh `[]` each render would retrigger layout effects and freeze the tab. */
const EMPTY_DIFF: { latinIndex: number; greekIdx: number }[] = [];

export function AlignmentCanvas({
  greek,
  latinEntries,
  edits,
  onEdit,
  diffRemoved = EMPTY_DIFF,
  editable = true,
  onRequestSubmit,
}: Props) {
  const shellRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const greekGroupRef = useRef<HTMLDivElement>(null);
  const latinGroupRef = useRef<HTMLDivElement>(null);
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

  const svgRef = useRef<SVGSVGElement>(null);
  const [greekOffset, setGreekOffset] = useState(0);
  const [latinOffset, setLatinOffset] = useState(0);
  const [dragging, setDragging] = useState<DragKind | null>(null);
  const [shellHeight, setShellHeight] = useState(DEFAULT_HEIGHT);
  /** Latest props for imperative draw (avoids effect churn from callback identity). */
  const propsRef = useRef({ greek, latinEntries, edits, diffRemoved });
  propsRef.current = { greek, latinEntries, edits, diffRemoved };
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
  const latinSig = `${latinEntries.length}:${latinEntries[0]?.latinWord ?? ""}:${latinEntries[latinEntries.length - 1]?.latinWord ?? ""}`;
  useEffect(() => {
    setGreekOffset((o) => (o === 0 ? o : 0));
    setLatinOffset((o) => (o === 0 ? o : 0));
  }, [greek.length, latinSig]);

  /** Imperative SVG paint — never setState, so parent re-renders cannot loop. */
  const drawLines = useCallback(() => {
    const canvas = canvasRef.current;
    const svg = svgRef.current;
    if (!canvas || !svg) return;
    const { greek: gWords, latinEntries: entries, edits: eMap, diffRemoved: removed } =
      propsRef.current;
    const crect = canvas.getBoundingClientRect();
    const nextW = Math.round(Math.max(canvas.scrollWidth, crect.width));
    const nextH = Math.round(Math.max(canvas.scrollHeight, crect.height));
    svg.setAttribute("width", String(nextW || 1));
    svg.setAttribute("height", String(nextH || 1));

    const next: Line[] = [];
    entries.forEach((entry, li) => {
      const latinEl = latinRefs.current[li];
      if (!latinEl) return;
      const raw =
        eMap[entry.latinIndex] ?? entry.pairs.map((p) => p.greekIdx).join(",");
      const { idxs, invalid } = parseIdxs(raw, gWords.length);
      const lrect = latinEl.getBoundingClientRect();
      const x1 = Math.round(lrect.left + lrect.width / 2 - crect.left);
      const y1 = Math.round(lrect.top - crect.top);
      idxs.forEach((gIdx) => {
        const gEl = greekRefs.current[gIdx]?.querySelector(".greek-word");
        if (!gEl) return;
        const grect = gEl.getBoundingClientRect();
        next.push({
          x1,
          y1,
          x2: Math.round(grect.left + grect.width / 2 - crect.left),
          y2: Math.round(grect.bottom - crect.top),
          invalid,
        });
      });
    });

    for (const rem of removed) {
      const li = entries.findIndex((e) => e.latinIndex === rem.latinIndex);
      const lEl = latinRefs.current[li];
      const gEl = greekRefs.current[rem.greekIdx]?.querySelector(".greek-word");
      if (!lEl || !gEl) continue;
      const lrect = lEl.getBoundingClientRect();
      const grect = gEl.getBoundingClientRect();
      next.push({
        x1: Math.round(lrect.left + lrect.width / 2 - crect.left),
        y1: Math.round(lrect.top - crect.top),
        x2: Math.round(grect.left + grect.width / 2 - crect.left),
        y2: Math.round(grect.bottom - crect.top),
        invalid: true,
      });
    }

    // Rebuild line nodes without React state.
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    const ns = "http://www.w3.org/2000/svg";
    for (const ln of next) {
      const el = document.createElementNS(ns, "line");
      el.setAttribute("x1", String(ln.x1));
      el.setAttribute("y1", String(ln.y1));
      el.setAttribute("x2", String(ln.x2));
      el.setAttribute("y2", String(ln.y2));
      el.setAttribute("stroke", ln.invalid ? "#cc0000" : "#0066CC");
      el.setAttribute("stroke-width", "2");
      if (ln.invalid) el.setAttribute("stroke-dasharray", "4 3");
      svg.appendChild(el);
    }
  }, []);

  const layoutRows = useCallback(() => {
    const shell = shellRef.current;
    const scroll = scrollRef.current;
    const canvas = canvasRef.current;
    const greekGroup = greekGroupRef.current;
    const latinGroup = latinGroupRef.current;
    const greekRow = greekRowRef.current;
    const latinRow = latinRowRef.current;
    if (
      !shell ||
      !scroll ||
      !canvas ||
      !greekGroup ||
      !latinGroup ||
      !greekRow ||
      !latinRow
    ) {
      return;
    }

    const { greek: gOff, latin: lOff } = offsetsRef.current;

    greekRow.style.width = "";
    greekRow.style.gap = `${MIN_GAP}px`;
    greekRow.style.justifyContent = "flex-start";
    latinRow.style.width = "";
    latinRow.style.gap = `${MIN_GAP}px`;
    latinRow.style.justifyContent = "flex-start";

    void greekRow.offsetHeight;

    const g = measureRow(greekRow);
    const l = measureRow(latinRow);
    fitRow(greekRow, g, g.contentWidth);
    fitRow(latinRow, l, l.contentWidth);
    greekGroup.style.marginBottom = "";

    void greekGroup.offsetWidth;
    const gBlock = greekGroup.offsetWidth;
    const lBlock = latinGroup.offsetWidth;

    const leftShift = Math.max(0, -gOff, -lOff);
    const rightEdge = Math.max(gBlock + gOff, lBlock + lOff, gBlock, lBlock);
    const padLeft = PAD_X + EDGE_SLACK + leftShift;
    const padRight = PAD_X + EDGE_SLACK;
    const sized = Math.ceil(padLeft + rightEdge + padRight);

    const viewH = scroll.clientHeight;
    canvas.style.height = `${viewH}px`;
    canvas.style.minHeight = `${viewH}px`;
    canvas.style.maxHeight = `${viewH}px`;
    canvas.style.minWidth = `${sized}px`;
    canvas.style.width = `${sized}px`;
    canvas.style.paddingLeft = `${padLeft}px`;
    canvas.style.paddingRight = `${padRight}px`;

    greekGroup.style.transform = `translateX(${gOff}px)`;
    latinGroup.style.transform = `translateX(${lOff}px)`;

    const parentW = shell.parentElement?.clientWidth ?? shell.clientWidth;
    const maxInner = Math.max(0, parentW - SHELL_BORDER_X);
    const fits = sized <= maxInner + 0.5;
    const nextShellWidth = fits ? `${sized + SHELL_BORDER_X}px` : "100%";
    if (shell.style.width !== nextShellWidth) {
      shell.style.width = nextShellWidth;
    }
    scroll.style.justifyContent = fits ? "center" : "flex-start";
  }, []);

  const redraw = useCallback(() => {
    layoutRows();
    drawLines();
  }, [drawLines, layoutRows]);

  // Layout when verse data / edits / drag offsets / height change — not on every parent render.
  useLayoutEffect(() => {
    redraw();
  }, [
    redraw,
    greekOffset,
    latinOffset,
    shellHeight,
    greek.length,
    latinSig,
    edits,
    diffRemoved,
  ]);

  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const onScroll = () => drawLines();
    const onWinResize = () => redraw();
    scroll.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onWinResize);
    return () => {
      scroll.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onWinResize);
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
    setDragging(kind);
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
    setDragging(null);
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
    <div className="alignment-workspace flex w-full min-w-0 justify-center">
      <div
        ref={shellRef}
        className="relative flex max-w-full flex-col rounded border-2 border-[#888] bg-[#fafafa]"
        style={{ height: shellHeight }}
      >
        <div
          className="absolute left-2 top-2 z-20"
          title={
            "Drag the Greek or Latin ⇄ handle sideways to untangle overlapping links. " +
            "Resize the workspace from the bottom edge. " +
            "Edits autosave and autosubmit after 300ms when indices are valid (session unlocked). " +
            "Tab to Submit and Proceed to advance to the next verse. " +
            "Unlock a session with its password to edit."
          }
        >
          <span
            className="inline-flex h-6 w-6 cursor-help items-center justify-center rounded-full border-2 border-[#888] bg-[#fff8e7] text-xs font-semibold text-[#523d02]"
            aria-label="Workspace help"
          >
            ?
          </span>
        </div>
        <div
          ref={scrollRef}
          className="flex min-h-0 flex-1 overflow-x-auto overflow-y-hidden"
        >
          <div
            ref={canvasRef}
            className="relative box-border flex h-full flex-col py-3"
          >
            <svg
              ref={svgRef}
              className="pointer-events-none absolute left-0 top-0 overflow-visible"
              width="1"
              height="1"
              aria-hidden
            />

            <div className="relative z-[1] flex h-full min-h-0 w-full flex-col justify-between">
              <div
                ref={greekGroupRef}
                className={`box-border flex w-fit shrink-0 max-w-none items-stretch rounded-md border-2 border-dashed pr-2 ${
                  dragging === "greek"
                    ? "border-[#0066CC] bg-[#e8f1ff] shadow-sm"
                    : "border-[#c9a86a] bg-[#EAC17D]/25 hover:border-[#a67c2a] hover:bg-[#EAC17D]/40"
                }`}
                style={{ touchAction: "none" }}
                onPointerDown={(e) => onRowPointerDown("greek", e)}
                onPointerMove={onRowPointerMove}
                onPointerUp={onRowPointerUp}
                onPointerCancel={onRowPointerUp}
                title="Drag to move the Greek word block"
                role="group"
                aria-label="Greek words — drag sideways to reposition"
              >
                <div
                  className="flex shrink-0 cursor-grab flex-col items-center justify-center gap-0.5 border-r-2 border-[#c9a86a] bg-[#EAC17D] px-2 py-1 text-[#523d02] select-none active:cursor-grabbing"
                  aria-hidden
                >
                  <span className="text-[0.65rem] font-semibold tracking-wide">
                    Greek
                  </span>
                  <span className="text-sm leading-none" aria-hidden>
                    ⇄
                  </span>
                  <span className="text-[0.6rem] uppercase tracking-wider opacity-80">
                    Drag
                  </span>
                </div>
                <div
                  ref={greekRowRef}
                  className="greek-row flex w-fit cursor-grab flex-nowrap items-end py-1 pl-1.5 pr-5 active:cursor-grabbing"
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
                        className={`greek-word min-w-[2.75rem] border-2 border-[#c9a86a] bg-[#EAC17D] px-1.5 py-1 text-center font-serif text-[0.95rem] ${
                          alignedGreek.has(i) ? "" : "border-dashed opacity-75"
                        }`}
                      >
                        {w}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div
                ref={latinGroupRef}
                className={`box-border flex w-fit shrink-0 max-w-none items-stretch rounded-md border-2 border-dashed pr-2 ${
                  dragging === "latin"
                    ? "border-[#0066CC] bg-[#e8f1ff] shadow-sm"
                    : "border-[#888] bg-white/80 hover:border-[#555] hover:bg-[#f3f3f3]"
                }`}
                style={{ touchAction: "none" }}
                onPointerDown={(e) => onRowPointerDown("latin", e)}
                onPointerMove={onRowPointerMove}
                onPointerUp={onRowPointerUp}
                onPointerCancel={onRowPointerUp}
                title="Drag to move the Latin word block"
                role="group"
                aria-label="Latin words — drag sideways to reposition"
              >
                <div
                  className="flex shrink-0 cursor-grab flex-col items-center justify-center gap-0.5 border-r-2 border-[#aaa] bg-[#e8e8e8] px-2 py-1 text-[#333] select-none active:cursor-grabbing"
                  aria-hidden
                >
                  <span className="text-[0.65rem] font-semibold tracking-wide">
                    Latin
                  </span>
                  <span className="text-sm leading-none" aria-hidden>
                    ⇄
                  </span>
                  <span className="text-[0.6rem] uppercase tracking-wider opacity-80">
                    Drag
                  </span>
                </div>
                <div
                  ref={latinRowRef}
                  className="latin-row flex w-fit cursor-grab flex-nowrap items-start py-1 pl-1.5 pr-5 active:cursor-grabbing"
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
                        className="flex shrink-0 flex-col items-center border-2 border-[#aaa] bg-white px-1.5 py-1"
                      >
                        <div className="min-w-[2.75rem] px-0.5 pb-1.5 text-center font-serif text-[0.95rem]">
                          {entry.latinWord}
                        </div>
                        {editable ? (
                          <input
                            className={`w-8 cursor-text border-2 text-center text-xs ${
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
        </div>

        <div
          className="flex h-4 shrink-0 cursor-ns-resize items-center justify-center border-t-2 border-[#ccc] bg-[#f0ebe0] hover:bg-[#e8e0d0]"
          onPointerDown={onResizePointerDown}
          onPointerMove={onResizePointerMove}
          onPointerUp={onResizePointerUp}
          onPointerCancel={onResizePointerUp}
          title="Drag to resize workspace height"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize alignment workspace"
        >
          <div className="h-0.5 w-12 rounded bg-[#aaa]" />
        </div>
      </div>
    </div>
  );
}
