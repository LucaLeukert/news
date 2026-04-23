"use client";

import {
  SignInButton,
  SignOutButton,
  SignUpButton,
  UserButton,
  useUser,
} from "@clerk/nextjs";

export function AccountBar({ proPriceId }: Readonly<{ proPriceId?: string }>) {
  const { isSignedIn } = useUser();

  if (!isSignedIn) {
    return (
      <div className="account-bar">
        <SignInButton mode="modal">
          <button type="button">Sign in</button>
        </SignInButton>
        <SignUpButton mode="modal">
          <button type="button">Create account</button>
        </SignUpButton>
      </div>
    );
  }

  return (
    <div className="account-bar">
      {proPriceId ? (
        <a className="billing-link" href="/billing">
          Billing
        </a>
      ) : (
        <span className="billing-link">Free plan</span>
      )}
      <UserButton />
      <SignOutButton>
        <button type="button">Sign out</button>
      </SignOutButton>
    </div>
  );
}
