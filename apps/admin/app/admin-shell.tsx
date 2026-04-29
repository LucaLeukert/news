import { UserButton } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import { Effect } from "effect";
import { ArrowUpRight, Database, Orbit, Send } from "lucide-react";
import Link from "next/link";
import type { ComponentType, ReactNode } from "react";
import { env } from "../env";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Separator } from "./components/ui/separator";

type NavItem = {
  readonly href: string;
  readonly label: string;
  readonly icon: ComponentType<{ className?: string }>;
};

const NAV_ITEMS: ReadonlyArray<NavItem> = [
  { href: "/", label: "Overview", icon: Orbit },
  { href: "/ai-jobs", label: "AI Runs", icon: Database },
  { href: "/enqueue", label: "Enqueue", icon: Send },
];

export async function AdminShell(props: {
  readonly title: string;
  readonly subtitle: string;
  readonly notice?: string | null;
  readonly currentPath: string;
  readonly children: ReactNode;
}) {
  const identity = await Effect.runPromise(
    Effect.tryPromise(() => auth()).pipe(
      Effect.catchIf(
        () => true,
        () => Effect.succeed({ userId: null, orgId: null }),
      ),
    ),
  );

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(245,158,11,0.16),_transparent_30%),radial-gradient(circle_at_top_right,_rgba(59,130,246,0.1),_transparent_26%),linear-gradient(180deg,_#fafaf9_0%,_#f5f5f4_100%)]">
      <div className="mx-auto flex min-h-screen w-full max-w-[1600px] flex-col gap-8 px-4 py-4 lg:flex-row lg:px-6 lg:py-6">
        <aside className="flex w-full flex-col rounded-[32px] border border-stone-200/80 bg-white/85 p-5 shadow-[0_24px_80px_rgba(28,25,23,0.08)] backdrop-blur lg:sticky lg:top-6 lg:h-[calc(100vh-3rem)] lg:w-80 lg:p-6">
          <div className="space-y-4">
            <div className="space-y-3">
              <Badge variant="muted" className="w-fit">
                Internal Console
              </Badge>
              <div>
                <p className="text-2xl font-semibold tracking-tight">
                  Coverage Lens
                </p>
                <p className="mt-2 text-sm leading-6 text-stone-500">
                  Typed operational tooling for crawl health, AI runs, and
                  manual intake.
                </p>
              </div>
            </div>
            <Separator />
          </div>
          <nav className="mt-6 flex flex-1 flex-col gap-2">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={
                  props.currentPath === item.href
                    ? "flex items-center gap-3 rounded-2xl bg-stone-950 px-4 py-3 text-sm font-medium text-stone-50 shadow-[0_12px_32px_rgba(28,25,23,0.16)]"
                    : "flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-medium text-stone-600 transition hover:bg-stone-100 hover:text-stone-950"
                }
              >
                <item.icon className="size-4" />
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="mt-6 space-y-4 rounded-[28px] border border-stone-200 bg-stone-50/80 p-4">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-stone-500">
                Session
              </p>
              <p className="text-sm text-stone-600">
                {identity.userId
                  ? `Authenticated operator ${identity.userId}`
                  : "Protected in production by Cloudflare Access and Clerk."}
              </p>
            </div>
            <Separator />
            <div className="space-y-3">
              <div className="text-xs font-semibold uppercase tracking-[0.22em] text-stone-500">
                API
              </div>
              <div className="break-all font-mono text-xs text-stone-600">
                {env.NEXT_PUBLIC_API_BASE_URL}
              </div>
            </div>
          </div>
        </aside>
        <section className="min-w-0 flex-1 space-y-6">
          <header className="rounded-[32px] border border-stone-200/80 bg-white/85 p-6 shadow-[0_24px_80px_rgba(28,25,23,0.08)] backdrop-blur lg:p-8">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
              <div className="space-y-3">
                <Badge variant="muted" className="w-fit">
                  Admin
                </Badge>
                <div className="space-y-2">
                  <h1 className="text-3xl font-semibold tracking-tight text-stone-950 lg:text-4xl">
                    {props.title}
                  </h1>
                  <p className="max-w-3xl text-sm leading-6 text-stone-600 lg:text-base">
                    {props.subtitle}
                  </p>
                </div>
                <p className="text-sm text-stone-500">
                  {identity.userId
                    ? `Authenticated operator ${identity.userId}`
                    : "Protected in production by Cloudflare Access and Clerk."}
                </p>
              </div>
              <div className="flex items-center gap-3 self-start">
                <Button asChild variant="secondary" size="sm">
                  <Link href="/" className="gap-2">
                    Console Home
                    <ArrowUpRight className="size-4" />
                  </Link>
                </Button>
                {env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ? <UserButton /> : null}
              </div>
            </div>
          </header>
          {props.notice ? (
            <div className="rounded-[28px] border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm font-medium text-emerald-800 shadow-sm">
              {props.notice}
            </div>
          ) : null}
          <div className="space-y-6">{props.children}</div>
        </section>
      </div>
    </main>
  );
}
