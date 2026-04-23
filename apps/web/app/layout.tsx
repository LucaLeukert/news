import "./styles.css";
import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import { env } from "../env";

export const metadata: Metadata = {
  title: "Coverage Lens",
  description: "Multilingual news coverage comparison and context.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const body = env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ? (
    <ClerkProvider publishableKey={env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY}>
      {children}
    </ClerkProvider>
  ) : (
    children
  );

  return (
    <html lang="en">
      <body>{body}</body>
    </html>
  );
}
