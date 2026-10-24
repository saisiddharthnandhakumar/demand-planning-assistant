import type { Metadata } from "next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-4">
      <div className="flex items-center gap-2.5">
        <svg viewBox="0 0 24 24" className="size-8" aria-hidden="true">
          <rect x="3" y="12" width="4" height="9" rx="1" fill="currentColor" opacity="0.35" />
          <rect x="10" y="7" width="4" height="14" rx="1" fill="currentColor" opacity="0.65" />
          <rect x="17" y="3" width="4" height="18" rx="1" fill="currentColor" />
          <rect x="1" y="10.5" width="22" height="1.5" rx="0.75" fill="var(--signal)" />
        </svg>
        <span className="text-lg font-medium tracking-tight">Demand planning</span>
      </div>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-lg">Sign in</CardTitle>
          <CardDescription>Enter the shared password to review this week’s recommendations.</CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm next={next ?? "/"} />
        </CardContent>
      </Card>
    </main>
  );
}
