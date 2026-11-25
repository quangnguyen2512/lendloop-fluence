import type { Metadata } from "next";
import { Providers } from "@/components/Providers";
import { isCloudStackConfigured } from "@/lib/runtimeConfig";
import "./globals.css";

export const metadata: Metadata = {
  title: "LendLoop — Neighborhood Tool Lending Library",
  description:
    "Borrow what you need. Lend what you don't. Community tool sharing with privacy-first data minimization and automated reminders.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cloudEnabled = isCloudStackConfigured();
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";

  return (
    <html lang="en">
      <body>
        <Providers cloudEnabled={cloudEnabled} convexUrl={convexUrl}>
          {children}
        </Providers>
      </body>
    </html>
  );
}
