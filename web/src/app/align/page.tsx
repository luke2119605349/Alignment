import { AlignmentWorkspace } from "@/components/AlignmentWorkspace";

export default function AlignPage() {
  return (
    <div className="w-full min-w-0 pb-20">
      <h1 className="mb-4 text-xl italic text-[#523d02]">Alignment session</h1>
      <AlignmentWorkspace />
    </div>
  );
}