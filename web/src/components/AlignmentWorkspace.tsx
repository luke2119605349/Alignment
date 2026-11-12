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
import { CollationPanel } from "@/components/CollationPanel";
import {
  bookCompletion,
  chapterCompletion,
  nextVerseRef,
  ntCompletion,
  ntVerseCompletion,
  prevVerseRef,
  progressColor,
  vidFor,
} from "@/lib/progress";
import { NT_BOOKS } from "@/lib/verse_data";

type Session = {
  id: number;
  label: string;
  username: string;
  status: string;
  createdAt: string;
};
type SourceMeta = { id: string; displayName: string; filename: string; isDefault?: boolean };
type SessionSortKey = "label" | "username" | "createdAt";

const SOURCE_PREF_KEY = "cntr_align_source";
const SESSION_PW_KEY = "cntr_session_pw";
const AUTOSAVE_MS = 300;

function loadStoredPasswords(): Record<string, string> {
  try {
    const raw = sessionStorage.getItem(SESSION_PW_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, string>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function storePassword(sessionId: number, password: string) {
  try {
    const next = loadStoredPasswords();
    next[String(sessionId)] = password;
    sessionStorage.setItem(SESSION_PW_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

function clearStoredPassword(sessionId: number) {
  try {
    const next = loadStoredPasswords();
    delete next[String(sessionId)];
    sessionStorage.setItem(SESSION_PW_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

function getStoredPassword(sessionId: number) {
  return loadStoredPasswords()[String(sessionId)] ?? "";
}

function formatSessionTime(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

function sortSessions(list: Session[], key: SessionSortKey, dir: "asc" | "desc") {
  const mul = dir === "asc" ? 1 : -1;
  return [...list].sort((a, b) => {
    if (key === "createdAt") {
      const ta = new Date(a.createdAt).getTime();
      const tb = new Date(b.createdAt).getTime();
      return (ta - tb) * mul;
    }
    return a[key].localeCompare(b[key], undefined, { sensitivity: "base" }) * mul;
  });
}

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

type VerseProg = { done: number; total: number; pct: number };

function ProgressBar({
  label,
  pct,
  detail,
  compact = false,
}: {
  label: string;
  pct: number;
  detail: string;
  compact?: boolean;
}) {
  const color = progressColor(pct);
  return (
    <div className={compact ? "min-w-[7rem] flex-1" : "min-w-[10rem] flex-1"}>
      <div className="mb-1 flex justify-between gap-2 text-xs">
        {label ? <span className="italic">{label}</span> : <span />}
        <span className="shrink-0">
          {Math.round(pct * 100)}% · {detail}
        </span>
      </div>
      <div
        className={`overflow-hidden rounded border-2 border-[#888] bg-[#eee] ${
          compact ? "h-2" : "h-2.5"
        }`}
      >
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
  const [sessionSort, setSessionSort] = useState<SessionSortKey>("createdAt");
  const [sessionSortDir, setSessionSortDir] = useState<"asc" | "desc">("desc");
  const [sessionsExpanded, setSessionsExpanded] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newSessionName, setNewSessionName] = useState("");
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [createError, setCreateError] = useState("");
  const [creating, setCreating] = useState(false);
  const [sessionPassword, setSessionPassword] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [sessionProgress, setSessionProgress] = useState<
    Record<number, VerseProg>
  >({});
  const [sources, setSources] = useState<SourceMeta[]>([]);
  const [alignmentSource, setAlignmentSource] = useState("aqua");
  const [greek, setGreek] = useState<string[]>([]);
  const [latinEntries, setLatinEntries] = useState<LatinAlignEntry[]>([]);
  const [baselineEntries, setBaselineEntries] = useState<LatinAlignEntry[]>([]);
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [baselineEdits, setBaselineEdits] = useState<Record<number, string>>({});
  const [alignmentJson, setAlignmentJson] = useState<unknown>(null);
  const [fromSession, setFromSession] = useState(false);
  const [showJson, setShowJson] = useState(false);
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
  const sessionPasswordRef = useRef(sessionPassword);
  const vidRef = useRef("");

  editsRef.current = edits;
  latinRef.current = latinEntries;
  greekRef.current = greek;
  sessionRef.current = session;
  sessionPasswordRef.current = sessionPassword;

  const unlocked = Boolean(session && sessionPassword);

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
  const verseProg = useMemo(() => ntVerseCompletion(completed), [completed]);

  const sortedSessions = useMemo(
    () => sortSessions(sessions, sessionSort, sessionSortDir),
    [sessions, sessionSort, sessionSortDir],
  );

  function toggleSessionSort(key: SessionSortKey) {
    if (sessionSort === key) {
      setSessionSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSessionSort(key);
      setSessionSortDir(key === "createdAt" ? "desc" : "asc");
    }
  }

  function sortMarker(key: SessionSortKey) {
    if (sessionSort !== key) return "";
    return sessionSortDir === "asc" ? " ▲" : " ▼";
  }

  useEffect(() => {
    try {
      const saved = localStorage.getItem(SOURCE_PREF_KEY);
      if (saved) setAlignmentSource(saved);
    } catch {
      /* ignore */
    }
  }, []);

  const applyProgressVids = useCallback(
    (sessionId: number, vids: string[]) => {
      const set = new Set(vids);
      const prog = ntVerseCompletion(set);
      setSessionProgress((prev) => ({
        ...prev,
        [sessionId]: {
          done: prog.done,
          total: prog.total,
          pct: prog.pct,
        },
      }));
      return set;
    },
    [],
  );

  const refreshSessionProgressMap = useCallback(
    async (list: Session[]) => {
      const entries = await Promise.all(
        list.map(async (s) => {
          try {
            const res = await fetch(`/api/sessions/${s.id}/progress`);
            if (!res.ok) return null;
            const data = await res.json();
            const vids: string[] = data.submittedVids ?? [];
            const prog = ntVerseCompletion(new Set(vids));
            return [
              s.id,
              { done: prog.done, total: prog.total, pct: prog.pct },
            ] as const;
          } catch {
            return null;
          }
        }),
      );
      const next: Record<number, VerseProg> = {};
      for (const entry of entries) {
        if (entry) next[entry[0]] = entry[1];
      }
      setSessionProgress(next);
    },
    [],
  );

  const refreshSessions = useCallback(async () => {
    const res = await fetch("/api/sessions");
    if (!res.ok) return [];
    const data = await res.json();
    const list: Session[] = (data.sessions ?? []).map(
      (s: Session & { username?: string | null; label?: string | null }) => ({
        ...s,
        label: s.label ?? "",
        username: s.username ?? "",
        createdAt: s.createdAt,
      }),
    );
    setSessions(list);
    void refreshSessionProgressMap(list);
    return list;
  }, [refreshSessionProgressMap]);

  const refreshProgress = useCallback(
    async (sessionId: number) => {
      const res = await fetch(`/api/sessions/${sessionId}/progress`);
      if (!res.ok) return;
      const data = await res.json();
      const vids: string[] = data.submittedVids ?? [];
      setCompletedVids(applyProgressVids(sessionId, vids));
    },
    [applyProgressVids],
  );

  const selectSession = useCallback(
    (s: Session | null) => {
      setSession(s);
      if (!s) {
        setSessionPassword("");
        return;
      }
      setSessionPassword(getStoredPassword(s.id));
      void refreshProgress(s.id);
    },
    [refreshProgress],
  );

  const unlockSessionWithPassword = useCallback(
    async (s: Session, password: string) => {
      if (!password.trim()) {
        setStatus("Password required to edit");
        return false;
      }
      setUnlocking(true);
      try {
        const res = await fetch(`/api/sessions/${s.id}/unlock`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setStatus(data.error ?? "Incorrect password");
          if (sessionRef.current?.id === s.id) setSessionPassword("");
          clearStoredPassword(s.id);
          return false;
        }
        setSession(s);
        setSessionPassword(password);
        storePassword(s.id, password);
        void refreshProgress(s.id);
        setStatus(`Unlocked “${s.label}” for editing`);
        return true;
      } finally {
        setUnlocking(false);
      }
    },
    [refreshProgress],
  );

  const editSession = useCallback(
    async (s: Session) => {
      const password =
        window.prompt(`Password for “${s.label}” (required to edit):`) ?? "";
      if (!password) {
        setStatus("Password required to edit");
        return;
      }
      await unlockSessionWithPassword(s, password);
    },
    [unlockSessionWithPassword],
  );

  const createSession = useCallback(async () => {
    const label = newSessionName.trim();
    const username = newUsername.trim();
    const password = newPassword;
    setCreateError("");
    if (!label) {
      setCreateError("Session name cannot be empty");
      return null;
    }
    if (!username) {
      setCreateError("Username cannot be empty");
      return null;
    }
    if (!password.trim()) {
      setCreateError("Password cannot be empty");
      return null;
    }
    if (password.length < 4) {
      setCreateError("Password must be at least 4 characters");
      return null;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceLanguage: "lat",
          targetLanguage: "grc",
          label,
          username,
          password,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCreateError(data.error ?? "Could not create session");
        return null;
      }
      const created = data.session as Session;
      storePassword(created.id, password);
      setSessionPassword(password);
      setSession(created);
      setShowCreateForm(false);
      setNewSessionName("");
      setNewUsername("");
      setNewPassword("");
      await refreshSessions();
      await refreshProgress(created.id);
      setStatus(`Created session “${created.label}”`);
      return created;
    } finally {
      setCreating(false);
    }
  }, [newPassword, newSessionName, newUsername, refreshProgress, refreshSessions]);

  const deleteSession = useCallback(
    async (s: Session) => {
      const password =
        (session?.id === s.id ? sessionPassword : "") ||
        getStoredPassword(s.id) ||
        window.prompt(`Password for “${s.label}” (required to delete):`) ||
        "";
      if (!password) {
        setStatus("Password required to delete session");
        return;
      }
      const ok = window.confirm(
        `Delete session “${s.label}” (${s.username})? This cannot be undone.`,
      );
      if (!ok) return;
      const res = await fetch(`/api/sessions/${s.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus(data.error ?? "Could not delete session");
        return;
      }
      clearStoredPassword(s.id);
      const list = await refreshSessions();
      if (session?.id === s.id) {
        const next = list[0] ?? null;
        selectSession(next);
        if (!next) {
          setCompletedVids(new Set());
          setSessionsExpanded(true);
          setShowCreateForm(true);
        }
      }
      setStatus(`Deleted session “${s.label}”`);
    },
    [refreshSessions, selectSession, session?.id, sessionPassword],
  );

  // Bootstrap once on mount — do not depend on callback identities (re-running
  // refreshSessions replaces `sessions` with a new array every time).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const list = await refreshSessions();
      if (cancelled) return;
      if (list.length === 0) {
        selectSession(null);
        setSessionsExpanded(true);
        setShowCreateForm(true);
        return;
      }
      setSession((prev) => {
        if (prev && list.some((s) => s.id === prev.id)) {
          const stored = getStoredPassword(prev.id);
          if (stored) setSessionPassword(stored);
          return prev;
        }
        const open = list.find((s) => s.status === "open") ?? list[0] ?? null;
        if (open) {
          const stored = getStoredPassword(open.id);
          setSessionPassword(stored);
          void refreshProgress(open.id);
        }
        return open;
      });
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only bootstrap
  }, []);

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
        if (data.alignmentSource) setAlignmentSource(data.alignmentSource);
      } finally {
        setLoading(false);
      }
    },
    [vid],
  );

  useEffect(() => {
    if (session) void loadVerse(session, alignmentSource, false);
  }, [session, vid, alignmentSource, loadVerse]);

  const persistAlignment = useCallback(
    async (opts: { submit?: boolean; silent?: boolean } = {}) => {
      const sess = sessionRef.current;
      if (!sess) return false;
      const password = sessionPasswordRef.current;
      if (!password) {
        if (!opts.silent) setStatus("Unlock the session with its password to save");
        return false;
      }
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
            password,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          if (!opts.silent) setStatus(data.error ?? "Save failed");
          if (res.status === 403) {
            setSessionPassword("");
            clearStoredPassword(sess.id);
          }
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

  const onEdit = useCallback((latinIndex: number, value: string) => {
    setEdits((prev) => ({ ...prev, [latinIndex]: value }));
    setDirty(true);
  }, []);

  const onRequestSubmit = useCallback(() => {
    submitBtnRef.current?.focus();
  }, []);

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

  function goPrevVerse() {
    const prev = prevVerseRef(bookIdx, chapter, verse);
    if (!prev) {
      setStatus("Already at the start of the New Testament");
      return;
    }
    setBookIdx(prev.bookIdx);
    setChapter(prev.chapter);
    setVerse(prev.verse);
  }

  function goNextVerse() {
    const next = nextVerseRef(bookIdx, chapter, verse);
    if (!next) {
      setStatus("Already at the end of the New Testament");
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
    setStatus(`Exporting “${s.label}”…`);
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
    const safeName = (s.label || `session-${s.id}`)
      .normalize("NFKD")
      .replace(/[^\w\s.-]+/g, "")
      .trim()
      .replace(/\s+/g, "_")
      .slice(0, 64);
    a.download = `cntr-alignment-${safeName || `session-${s.id}`}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setStatus(`Exported “${s.label}”`);
  }

  const chapters = book.verseCounts.length;
  const verseCount = book.verseCounts[chapter - 1] ?? 1;

  return (
    <div className="flex w-full min-w-0 flex-col gap-4">
      {/* —— Session strip —— */}
      <section className="rounded-md border-2 border-[#888] bg-white p-3">
        <div
          className={`flex items-center gap-3 ${
            sessionsExpanded ? "flex-wrap" : "min-w-0"
          }`}
        >
          <div className="flex shrink-0 flex-wrap items-center gap-3">
            <button
              type="button"
              className="rounded border-2 border-[#888] bg-[#f8f8f8] px-2.5 py-1 text-sm"
              onClick={() => setSessionsExpanded((v) => !v)}
              aria-expanded={sessionsExpanded}
              title={sessionsExpanded ? "Hide session list" : "Show all sessions"}
            >
              {sessionsExpanded ? "▾ Sessions" : "▸ Sessions"}
            </button>
            {!sessionsExpanded && session && (
              <div className="min-w-0 text-left text-sm">
                <span className="font-medium">{session.label}</span>
                <span className="text-[#666]">
                  {" "}
                  · {session.username} · {formatSessionTime(session.createdAt)}
                </span>
                {unlocked && (
                  <p className="mt-0.5 text-xs text-[#2e7d32]">
                    Unlocked — edits and delete are enabled in this browser tab.
                  </p>
                )}
              </div>
            )}
            {!sessionsExpanded && !session && (
              <span className="text-sm text-[#666]">No session selected</span>
            )}
            <button
              type="button"
              onClick={() => {
                setSessionsExpanded(true);
                setShowCreateForm(true);
                setCreateError("");
              }}
              className="rounded border-2 border-black bg-[#C1FCC1] px-3 py-1.5 text-sm"
            >
              New session
            </button>
          </div>
          {!sessionsExpanded && session && (
            <div className="flex min-w-0 flex-1 flex-wrap gap-3">
              <ProgressBar
                label="All verses"
                pct={verseProg.pct}
                detail={`${verseProg.done}/${verseProg.total}`}
                compact
              />
              <ProgressBar
                label="Chapter verses"
                pct={chapterProg.pct}
                detail={`${chapterProg.done}/${chapterProg.total}`}
                compact
              />
              <ProgressBar
                label="Book chapters"
                pct={bookProg.pct}
                detail={`${bookProg.done}/${bookProg.total}`}
                compact
              />
              <ProgressBar
                label="NT books"
                pct={ntProg.pct}
                detail={`${ntProg.done}/${ntProg.total}`}
                compact
              />
            </div>
          )}
        </div>

        {sessionsExpanded && (
          <div className="mt-4">
            {showCreateForm && (
              <form
                className="mb-3 grid gap-3 rounded-md border-2 border-[#c9a86a] bg-[#fff8e7] p-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_auto]"
                onSubmit={(e) => {
                  e.preventDefault();
                  void createSession();
                }}
              >
                <label className="text-xs italic">
                  Session name
                  <input
                    className="mt-1 w-full border-2 border-[#888] bg-white px-2 py-1.5 text-sm"
                    value={newSessionName}
                    onChange={(e) => setNewSessionName(e.target.value)}
                    placeholder="Unique name"
                    required
                    maxLength={120}
                    autoFocus
                  />
                </label>
                <label className="text-xs italic">
                  Username
                  <input
                    className="mt-1 w-full border-2 border-[#888] bg-white px-2 py-1.5 text-sm"
                    value={newUsername}
                    onChange={(e) => setNewUsername(e.target.value)}
                    placeholder="Your name"
                    required
                    maxLength={80}
                  />
                </label>
                <label className="text-xs italic">
                  Password
                  <input
                    type="password"
                    className="mt-1 w-full border-2 border-[#888] bg-white px-2 py-1.5 text-sm"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Required to edit/delete"
                    required
                    minLength={4}
                    autoComplete="new-password"
                  />
                </label>
                <div className="flex items-end gap-2">
                  <button
                    type="submit"
                    disabled={creating}
                    className="rounded border-2 border-black bg-[#C1FCC1] px-3 py-1.5 text-sm"
                  >
                    {creating ? "Creating…" : "Create"}
                  </button>
                  {sessions.length > 0 && (
                    <button
                      type="button"
                      className="rounded border-2 border-[#888] bg-white px-3 py-1.5 text-sm"
                      onClick={() => {
                        setShowCreateForm(false);
                        setCreateError("");
                      }}
                    >
                      Cancel
                    </button>
                  )}
                </div>
                {createError && (
                  <p className="text-xs text-[#a00] sm:col-span-full">{createError}</p>
                )}
              </form>
            )}

            {sortedSessions.length === 0 ? (
              <p className="text-sm text-[#666]">
                No sessions yet — create one with a unique name and username.
              </p>
            ) : (
              <div className="max-h-56 overflow-auto rounded-md border-2 border-[#ddd]">
                <table className="w-full min-w-[40rem] border-collapse text-left text-sm">
                  <thead className="sticky top-0 bg-[#f3eee0]">
                    <tr>
                      <th className="border-b-2 border-[#ddd] px-3 py-2 font-normal italic">
                        <button
                          type="button"
                          className="hover:underline"
                          onClick={() => toggleSessionSort("label")}
                        >
                          Name{sortMarker("label")}
                        </button>
                      </th>
                      <th className="border-b-2 border-[#ddd] px-3 py-2 font-normal italic">
                        <button
                          type="button"
                          className="hover:underline"
                          onClick={() => toggleSessionSort("username")}
                        >
                          Username{sortMarker("username")}
                        </button>
                      </th>
                      <th className="border-b-2 border-[#ddd] px-3 py-2 font-normal italic">
                        <button
                          type="button"
                          className="hover:underline"
                          onClick={() => toggleSessionSort("createdAt")}
                        >
                          Created{sortMarker("createdAt")}
                        </button>
                      </th>
                      <th className="border-b-2 border-[#ddd] px-3 py-2 font-normal italic">
                        All verses
                      </th>
                      <th className="border-b-2 border-[#ddd] px-3 py-2 font-normal italic">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedSessions.map((s) => {
                      const active = session?.id === s.id;
                      const prog = sessionProgress[s.id];
                      return (
                        <tr
                          key={s.id}
                          role="button"
                          tabIndex={0}
                          className={
                            active
                              ? "cursor-pointer bg-[#fff3c4]"
                              : "cursor-pointer bg-white hover:bg-[#faf6ea]"
                          }
                          onClick={() => selectSession(s)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              selectSession(s);
                            }
                          }}
                        >
                          <td className="border-b border-[#eee] px-3 py-2 font-medium">
                            {s.label}
                          </td>
                          <td className="border-b border-[#eee] px-3 py-2 text-[#444]">
                            {s.username}
                          </td>
                          <td className="border-b border-[#eee] px-3 py-2 whitespace-nowrap text-[#444]">
                            {formatSessionTime(s.createdAt)}
                          </td>
                          <td
                            className="border-b border-[#eee] px-3 py-2"
                            style={{ minWidth: "9rem" }}
                          >
                            {prog ? (
                              <ProgressBar
                                label=""
                                pct={prog.pct}
                                detail={`${prog.done}/${prog.total}`}
                                compact
                              />
                            ) : (
                              <span className="text-xs text-[#888]">…</span>
                            )}
                          </td>
                          <td
                            className="border-b border-[#eee] px-3 py-2 whitespace-nowrap"
                            onClick={(e) => e.stopPropagation()}
                            onKeyDown={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              onClick={() => selectSession(s)}
                              className="mr-2 rounded border-2 border-black bg-[#C1FCC1] px-2 py-0.5 text-xs"
                              title={`View “${s.label}”`}
                            >
                              View
                            </button>
                            <button
                              type="button"
                              onClick={() => void editSession(s)}
                              disabled={unlocking}
                              className="mr-2 rounded border-2 border-black bg-[#FAD780] px-2 py-0.5 text-xs"
                              title={`Edit “${s.label}” (password required)`}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => void exportSession(s)}
                              className="mr-2 rounded border-2 border-black bg-white px-2 py-0.5 text-xs"
                              title={`Export “${s.label}”`}
                            >
                              Export
                            </button>
                            <button
                              type="button"
                              onClick={() => void deleteSession(s)}
                              className="rounded border-2 border-[#a00] bg-white px-2 py-0.5 text-xs text-[#a00]"
                              title={`Delete “${s.label}”`}
                            >
                              Delete
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </section>

      {/* —— Progress (when session list is expanded) —— */}
      {sessionsExpanded && (
        <section className="rounded-md border-2 border-[#c9a86a] bg-[#fff8e7] p-3">
          <h2 className="mb-2 text-sm italic text-[#523d02]">Progress</h2>
          <div className="flex flex-wrap gap-3">
            <ProgressBar
              label="All verses"
              pct={verseProg.pct}
              detail={`${verseProg.done}/${verseProg.total}`}
            />
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
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={goPrevVerse}
          className="rounded border-2 border-black bg-white px-3 py-1.5 text-sm"
          title="Previous verse"
        >
          ← Prev
        </button>
        <select
          className="border-2 border-[#888] px-2.5 py-1.5"
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
          className="border-2 border-[#888] px-2.5 py-1.5"
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
          className="border-2 border-[#888] px-2.5 py-1.5"
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
        <button
          type="button"
          onClick={goNextVerse}
          className="rounded border-2 border-black bg-white px-3 py-1.5 text-sm"
          title="Next verse"
        >
          Next →
        </button>
        <label className="text-sm italic">
          Default alignment
          <select
            className="ml-2 min-w-[12rem] border-2 border-[#888] bg-white px-2.5 py-1.5"
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
        <span className="text-xs text-[#666]">
          vid {vid}
          {completed.has(vid) ? " · submitted" : ""}
          {fromSession ? " · session edits" : ""}
          {loading || saving ? (loading ? " · Loading…" : " · Saving…") : ""}
        </span>
      </div>

      {session && (
        <section className="w-full min-w-0">
          <AlignmentCanvas
            greek={greek}
            latinEntries={latinEntries}
            edits={edits}
            onEdit={onEdit}
            editable={unlocked}
            onRequestSubmit={onRequestSubmit}
          />

          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={goPrevVerse}
              className="rounded border-2 border-black bg-white px-3 py-2 text-sm"
            >
              ← Prev
            </button>
            <button
              type="button"
              onClick={goNextVerse}
              className="rounded border-2 border-black bg-white px-3 py-2 text-sm"
            >
              Next →
            </button>
            <button
              ref={submitBtnRef}
              type="button"
              onClick={() => void submitAndProceed()}
              disabled={loading || saving || !unlocked}
              className="rounded border-2 border-black bg-[#C1FCC1] px-4 py-2 text-sm font-medium"
            >
              Submit and Proceed
            </button>
            <button
              type="button"
              onClick={() => void exportSession(session)}
              className="rounded border-2 border-black bg-white px-3 py-2 text-sm"
              title="Export the currently selected session"
            >
              Export Current Session
            </button>
            <button
              type="button"
              onClick={resetToBaseline}
              disabled={!unlocked}
              className="rounded border-2 border-black bg-[#FAD780] px-3 py-2 text-sm"
            >
              Restore default indices
            </button>
            <button
              type="button"
              onClick={clearLinks}
              disabled={!unlocked}
              className="rounded border-2 border-black bg-white px-3 py-2 text-sm"
            >
              Clear links
            </button>
            <button
              type="button"
              onClick={() => setShowJson((v) => !v)}
              className="rounded border-2 border-black bg-white px-3 py-2 text-sm"
            >
              {showJson ? "Hide" : "Show"} JSON
            </button>
            {status && <span className="text-sm text-[#444]">{status}</span>}
          </div>

          {showJson && (
            <textarea
              className="mt-4 w-full min-h-[8rem] border-2 border-[#888] p-3 font-mono text-xs"
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

          <div className="mt-6">
            <CollationPanel vid={vid} />
          </div>
        </section>
      )}
    </div>
  );
}
