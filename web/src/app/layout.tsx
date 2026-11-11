import { Suspense } from "react";
import type { Metadata } from "next";
import { ClerkProvider, Show, SignInButton, UserButton } from "@clerk/nextjs";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "CNTR Alignment",
  description: "Volunteer Greek–Latin alignment and manuscript variants",
};

function OptionalAccount() {
  return (
    <>
      <Show when="signed-out">
        <SignInButton mode="modal">
          <button
            type="button"
            className="text-xs text-[#523d02] underline decoration-dotted"
            title="Optional — not required to align"
          >
            Link account
          </button>
        </SignInButton>
      </Show>
      <Show when="signed-in">
        <UserButton />
      </Show>
    </>
  );
}

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
              <Suspense fallback={null}>
                <OptionalAccount />
              </Suspense>
            </nav>
          </header>
          <main className="flex-1 p-4">{children}</main>
        </body>
      </html>
    </ClerkProvider>
  );
}
