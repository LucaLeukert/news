"use client";

import {
  SignInButton,
  SignOutButton,
  SignUpButton,
  UserButton,
  useUser,
} from "@clerk/nextjs";
import Link from "next/link";
import { Button } from "./components/ui/button";

export function AccountBar({ proPriceId }: Readonly<{ proPriceId?: string }>) {
  const { isSignedIn } = useUser();

  if (!isSignedIn) {
    return (
      <div className="flex items-center gap-2">
        <SignInButton mode="modal">
          <Button type="button" variant="ghost" size="sm">
            Sign in
          </Button>
        </SignInButton>
        <SignUpButton mode="modal">
          <Button type="button" size="sm">
            Create account
          </Button>
        </SignUpButton>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      {proPriceId ? (
        <Button asChild variant="secondary" size="sm">
          <Link href="/billing">Billing</Link>
        </Button>
      ) : (
        <span className="rounded-full border border-stone-200 bg-white px-3 py-2 text-xs font-medium uppercase tracking-[0.18em] text-stone-500">
          Free plan
        </span>
      )}
      <UserButton />
      <SignOutButton>
        <Button type="button" variant="ghost" size="sm">
          Sign out
        </Button>
      </SignOutButton>
    </div>
  );
}
