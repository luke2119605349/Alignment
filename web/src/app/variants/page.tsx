import { VariantBrowser } from "@/components/VariantBrowser";

export default function VariantsPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <h1 className="text-xl italic text-[#523d02]">Manuscript variants</h1>
      <p className="text-sm text-[#523d02]">
        Authoritative Greek text is the CNTR Classic stream. Other manuscripts
        are reconstructed by applying Myers ops against that base.
      </p>
      <VariantBrowser />
    </div>
  );
}
