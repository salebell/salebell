import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Logo } from "@/components/logo";
import { LoginForm } from "./login-form";
import { IS_SELF_HOSTED, COMPANY_NAME } from "@/lib/env";

export const metadata: Metadata = { title: "Sign in", robots: { index: false } };

export default function LoginPage() {
  return (
    <main id="main" className="flex flex-1 flex-col items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>
        <div className="rounded-2xl border border-border bg-surface p-6 shadow-[0_20px_50px_-35px_rgb(0_0_0/0.35)] sm:p-7">
          <Suspense>
            <LoginForm />
          </Suspense>
        </div>
        <p className="mt-6 text-center text-xs leading-relaxed text-muted">
          {IS_SELF_HOSTED ? <>This instance is operated by {COMPANY_NAME}. </> : null}
          By continuing you agree to the <Link href="/terms" className="underline underline-offset-2 hover:text-fg">terms</Link> and{" "}
          <Link href="/privacy" className="underline underline-offset-2 hover:text-fg">privacy policy</Link>.
        </p>
      </div>
    </main>
  );
}
