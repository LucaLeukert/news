import "./globals.css";
import { cn } from "@/app/lib/utils";
import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import { Geist, IBM_Plex_Mono, Newsreader } from "next/font/google";
import type { ReactNode } from "react";
import { env } from "../env";

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-sans",
});

const serif = Newsreader({
  subsets: ["latin"],
  variable: "--font-serif",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "Coverage Lens",
  description: "Multilingual news coverage comparison and context.",
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
    <html lang="en" className={cn("font-sans", geist.variable)}>
      <body
        className={`${geist.variable} ${serif.variable} ${mono.variable} min-h-screen bg-stone-100 font-sans text-stone-950 antialiased`}
      >
        {body}
      </body>
    </html>
  );
}
