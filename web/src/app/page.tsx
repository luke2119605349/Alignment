import Link from "next/link";
import { SignedIn, SignedOut, SignInButton } from "@clerk/nextjs";

export default function HomePage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold text-[#523d02]">
        Greek / Latin alignment workspace
      </h1>
      <p className="text-[#523d02]">
        Volunteers can open an alignment session, review Aqua-seeded links between
        Stuttgart Latin and the CNTR Greek base text, and save corrections.
        Manuscript variants are stored as Myers ops against each language&apos;s
        authoritative base — not as full duplicate texts.
      </p>
      <SignedOut>
        <SignInButton mode="modal">
          <button className="rounded border border-black bg-[#C1FCC1] px-4 py-2">
            Sign in to continue
          </button>
        </SignInButton>
      </SignedOut>
      <SignedIn>
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
      </SignedIn>
    </div>
  );
}
