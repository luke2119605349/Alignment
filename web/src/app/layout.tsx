import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "CNTR Alignment",
  description: "Volunteer Greek–Latin alignment and manuscript variants",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full flex flex-col bg-[#faf6ea] text-[#2b2208]">
        <header className="flex items-center gap-5 border-b-2 border-[#c9a86a] bg-[#F5C13C] px-6 py-3">
          <Link href="/" className="text-lg font-semibold grow">
            CNTR Alignment
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/align" className="hover:underline">
              Align
            </Link>
            <Link href="/variants" className="hover:underline">
              Variants
            </Link>
          </nav>
        </header>
        <main className="min-w-0 flex-1 overflow-x-hidden p-6">{children}</main>
      </body>
    </html>
  );
}
