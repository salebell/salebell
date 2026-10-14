import { Logo } from "@/components/logo";
import { ButtonLink } from "@/components/ui";

export default function NotFound() {
  return (
    <main id="main" className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-6 px-4 py-24 text-center">
      <Logo />
      <div>
        <p className="font-mono text-sm text-muted">404</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">This page doesn&apos;t exist</h1>
        <p className="mt-2 text-muted">The link may be old, or the page moved.</p>
      </div>
      <ButtonLink href="/" variant="secondary">
        Back to the homepage
      </ButtonLink>
    </main>
  );
}
