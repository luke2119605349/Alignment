import { AlignmentWorkspace } from "@/components/AlignmentWorkspace";

export default function AlignPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <h1 className="text-xl italic text-[#523d02]">Alignment session</h1>
      <p className="text-sm text-[#523d02]">
        Edit Latin→Greek word links for the current verse. Saves are stored on
        your anonymous volunteer session and override the system/Aqua seed for
        that session only. Email sign-in is optional.
      </p>
      <AlignmentWorkspace />
    </div>
  );
}
