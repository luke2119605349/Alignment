import { AlignmentWorkspace } from "@/components/AlignmentWorkspace";

export default function AlignPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <h1 className="text-xl italic text-[#523d02]">Alignment session</h1>
      <p className="text-sm text-[#523d02]">
        Visual links load from the selected Aqua baseline (default or bespoke).
        Edit indices under each Latin word, save to your anonymous session, or
        restore the baseline. Optional diff highlights removals vs the chosen
        default.
      </p>
      <AlignmentWorkspace />
    </div>
  );
}
