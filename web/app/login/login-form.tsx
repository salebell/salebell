"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Alert, Button, Field, Input } from "@/components/ui";
import { CODE_MINUTES, PENDING_SIGN_IN_KEY, RESEND_SECONDS, pendingSignIn, resendIn } from "@/lib/pending-sign-in";
import { safeNext } from "@/lib/safe-next";
import { DEPLOYMENT_MODE, IS_SELF_HOSTED } from "@/lib/env";
import { initialSignInStep } from "@/lib/deployment";
import { supabaseBrowser } from "@/lib/supabase/client";

function clearPendingSignIn() {
  try { sessionStorage.removeItem(PENDING_SIGN_IN_KEY); } catch { /* Storage is optional. */ }
}

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [step, setStep] = useState<"email" | "code" | "password">(() => initialSignInStep(DEPLOYMENT_MODE, false));
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(
    params.get("error") === "link" ? "That sign-in link has expired or was opened in another browser. Send a new code." : null,
  );
  const [cooldown, setCooldown] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);
  const next = params.get("next");

  useEffect(() => {
    try {
      const pending = pendingSignIn(sessionStorage.getItem(PENDING_SIGN_IN_KEY));
      if (pending) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- restore the pending sign-in after hydration
        setEmail(pending.email);
        setStep(initialSignInStep(DEPLOYMENT_MODE, true));
        setCooldown(resendIn(pending.sentAt));
      } else {
        clearPendingSignIn();
      }
    } catch { /* Sign-in still works when browser storage is unavailable. */ }

    let active = true;
    void supabaseBrowser().auth.getSession().then(({ data }) => {
      if (active && data.session) {
        clearPendingSignIn();
        router.replace(safeNext(next, window.location.origin));
      }
    });
    return () => { active = false; };
  }, [next, router]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  useEffect(() => {
    if (step === "code") codeRef.current?.focus();
  }, [step]);

  async function sendCode(e?: FormEvent) {
    e?.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const callback = new URL("/auth/callback", window.location.origin);
    callback.searchParams.set("next", safeNext(params.get("next"), window.location.origin));
    const { error } = await supabaseBrowser().auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: true, emailRedirectTo: callback.href },
    });
    setBusy(false);
    if (error) {
      setError(error.status === 429 ? "Too many attempts. Wait a minute and try again." : error.message);
      return;
    }
    setStep("code");
    setCode("");
    setCooldown(RESEND_SECONDS);
    try {
      sessionStorage.setItem(PENDING_SIGN_IN_KEY, JSON.stringify({ email: email.trim(), sentAt: Date.now() }));
    } catch { /* This visit can continue without storage. */ }
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    if (busy || code.length !== 6) return;
    setBusy(true);
    setError(null);
    const { error } = await supabaseBrowser().auth.verifyOtp({ email: email.trim(), token: code.trim(), type: "email" });
    if (error) {
      setBusy(false);
      setError(error.message.toLowerCase().includes("expired") || error.message.toLowerCase().includes("invalid")
        ? "That code is invalid or has expired. Check the latest email or send a new code."
        : error.message);
      return;
    }
    clearPendingSignIn();
    router.replace(safeNext(next, window.location.origin));
    router.refresh();
  }

  // Self-hosted owners are created by the installer; password sign-in needs no SMTP.
  async function signInWithPassword(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const { error } = await supabaseBrowser().auth.signInWithPassword({ email: email.trim(), password });
    if (error) {
      setBusy(false);
      setPassword("");
      setError(error.code === "invalid_credentials" ? "That email and password don't match." : error.status === 429 ? "Too many attempts. Wait a minute and try again." : error.message);
      return;
    }
    clearPendingSignIn();
    router.replace(safeNext(next, window.location.origin));
    router.refresh();
  }

  if (step === "password") {
    return (
      <form onSubmit={signInWithPassword} className="space-y-5">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Sign in with a password</h1>
          <p className="mt-1.5 text-sm text-muted">{IS_SELF_HOSTED ? "Use the account created by your instance administrator. No sign-in email is needed." : "Sign in with your email and password."}</p>
        </div>
        <Field label="Email" htmlFor="email">
          <Input id="email" type="email" autoComplete="username" required autoFocus={!email} disabled={busy} value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password" htmlFor="password">
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            disabled={busy}
            autoFocus={Boolean(email)}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        {error && <Alert>{error}</Alert>}
        <Button type="submit" loading={busy} disabled={!password} className="w-full" size="lg">
          Sign in
        </Button>
        <button
          type="button"
          className="text-sm text-muted underline-offset-2 hover:text-fg hover:underline"
          disabled={busy}
          onClick={() => { setStep("email"); setPassword(""); setError(null); }}
        >
          Email me a code instead
        </button>
      </form>
    );
  }

  if (step === "email") {
    return (
      <form onSubmit={sendCode} className="space-y-5" noValidate={false}>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{IS_SELF_HOSTED ? "Sign in by email" : "Sign in or create an account"}</h1>
          <p className="mt-1.5 text-sm text-muted">{IS_SELF_HOSTED ? "If your instance has email delivery configured, we'll send you a 6-digit code." : "We'll email you a 6-digit code. No password needed."}</p>
        </div>
        <Field label="Email" htmlFor="email">
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            disabled={busy}
            autoFocus
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        {error && <Alert>{error}</Alert>}
        <Button type="submit" loading={busy} className="w-full" size="lg">
          Email me a code
        </Button>
        <button
          type="button"
          className="text-sm text-muted underline-offset-2 hover:text-fg hover:underline"
          disabled={busy}
          onClick={() => { setStep("password"); setError(null); }}
        >
          Use a password
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={verify} className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Check your email</h1>
        <p className="mt-1.5 text-sm text-muted">
          We sent a 6-digit code to <span className="font-medium text-fg">{email}</span>. Not there? Check spam. The code expires in{" "}
          {CODE_MINUTES} minutes.
        </p>
      </div>
      <Field label="Code" htmlFor="code">
        <Input
          ref={codeRef}
          id="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          required
          disabled={busy}
          placeholder="123456"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          className="h-12 text-center font-mono text-xl tracking-[0.5em] tnum"
        />
      </Field>
      {error && <Alert>{error}</Alert>}
      <Button type="submit" loading={busy} disabled={code.length !== 6} className="w-full" size="lg">
        Verify and continue
      </Button>
      <div className="flex items-center justify-between text-sm">
        <button type="button" disabled={busy} className="text-muted underline-offset-2 hover:text-fg hover:underline" onClick={() => { clearPendingSignIn(); setStep("email"); setCode(""); setError(null); }}>
          Use another email
        </button>
        <button
          type="button"
          className="text-muted underline-offset-2 hover:text-fg hover:underline disabled:no-underline disabled:opacity-60"
          disabled={cooldown > 0 || busy}
          onClick={() => sendCode()}
        >
          {cooldown > 0 ? <span className="tnum">Resend in {cooldown}s</span> : "Resend code"}
        </button>
      </div>
    </form>
  );
}
