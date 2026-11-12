"use client";

import { useEffect, useState } from "react";

type CollationPayload = {
  vid: string;
  title: string;
  sourceUrl: string;
  cssHref: string;
  tableHtml: string;
};

export function CollationPanel({ vid }: { vid: string }) {
  const [data, setData] = useState<CollationPayload | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    setData(null);
    void (async () => {
      try {
        const res = await fetch(`/api/collation/${vid}`);
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (!cancelled) setError(json.error ?? "Collation unavailable");
          return;
        }
        if (!cancelled) setData(json as CollationPayload);
      } catch {
        if (!cancelled) setError("Collation unavailable");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [vid]);

  useEffect(() => {
    if (!data?.cssHref) return;
    const id = "cntr-collation-css";
    let link = document.getElementById(id) as HTMLLinkElement | null;
    if (!link) {
      link = document.createElement("link");
      link.id = id;
      link.rel = "stylesheet";
      document.head.appendChild(link);
    }
    link.href = data.cssHref;
  }, [data?.cssHref]);

  return (
    <section className="mt-4 rounded-md border-2 border-[#888] bg-white p-3">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm italic text-[#523d02]">
          CNTR collation{data?.title ? ` — ${data.title}` : ` — ${vid}`}
        </h2>
        <a
          className="text-xs text-[#523d02] underline"
          href={`https://greekcntr.org/collation/index.html?&v=${vid}`}
          target="_blank"
          rel="noreferrer"
        >
          Open on greekcntr.org
        </a>
      </div>
      {loading && <p className="text-sm text-[#666]">Loading collation…</p>}
      {error && !loading && <p className="text-sm text-[#a00]">{error}</p>}
      {data && !loading && (
        <div
          id="collation"
          className="cntr-collation-embed max-h-[28rem] overflow-auto text-sm"
          dangerouslySetInnerHTML={{ __html: data.tableHtml }}
        />
      )}
    </section>
  );
}
