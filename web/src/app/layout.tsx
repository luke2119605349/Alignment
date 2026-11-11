import type { Metadata } from "next";
import { ClerkProvider, SignedIn, SignedOut, SignInButton, UserButton } from "@clerk/nextjs";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "CNTR Alignment",
  description: "Volunteer Greek–Latin alignment and manuscript variants",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <ClerkProvider>
      <html lang="en" className="h-full">
        <body className="min-h-full flex flex-col bg-[#faf6ea] text-[#2b2208]">
          <header className="flex items-center gap-4 bg-[#F5C13C] px-4 py-2">
            <Link href="/" className="text-lg font-semibold grow">
              CNTR Alignment
            </Link>
            <nav className="flex items-center gap-3 text-sm">
              <Link href="/align" className="hover:underline">
                Align
              </Link>
              <Link href="/variants" className="hover:underline">
                Variants
              </Link>
              <SignedOut>
                <SignInButton mode="modal">
                  <button className="rounded border border-black bg-[#C1FCC1] px-3 py-1">
                    Sign in
                  </button>
                </SignInButton>
              </SignedOut>
              <SignedIn>
                <UserButton />
              </SignedIn>
            </nav>
          </header>
          <main className="flex-1 p-4">{children}</main>
        </body>
      </html>
    </ClerkProvider>
  );
}
