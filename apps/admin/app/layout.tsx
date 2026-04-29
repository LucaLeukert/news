import "./globals.css";
import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import { Geist, IBM_Plex_Mono } from "next/font/google";
import type { ReactNode } from "react";
import { env } from "../env";
import { InternalRpcProvider } from "./providers";

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-sans",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "Coverage Lens Admin",
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const body = env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ? (
    <ClerkProvider publishableKey={env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY}>
      {children}
    </ClerkProvider>
  ) : (
    children
  );

  return (
    <html lang="en" className={geist.variable}>
      <body
        className={`${geist.variable} ${mono.variable} min-h-screen bg-stone-100 font-sans text-stone-950 antialiased`}
      >
        <InternalRpcProvider>{body}</InternalRpcProvider>
      </body>
    </html>
  );
}
