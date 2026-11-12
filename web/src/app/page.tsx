import Link from "next/link";

export default function HomePage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold text-[#523d02]">
        Greek / Latin alignment workspace
      </h1>
      <p className="text-[#523d02]">
        Open an alignment session, review Aqua-seeded links between Stuttgart
        Latin and the CNTR Greek base text, and save corrections. Sessions are
        public; a username and password protect edit and delete. Manuscript
        variants are reconstructed with Myers ops against each language&apos;s
        authoritative base.
      </p>
      <div className="flex flex-wrap gap-3">
        <Link
          href="/align"
          className="rounded border border-black bg-[#C1FCC1] px-4 py-2"
        >
          Start aligning
        </Link>
        <Link
          href="/variants"
          className="rounded border border-black bg-[#FAD780] px-4 py-2"
        >
          Browse variants
        </Link>
      </div>
    </div>
  );
}
