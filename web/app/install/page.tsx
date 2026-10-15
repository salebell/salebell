import Link from "next/link";
import { connection } from "next/server";
import { SITE_URL } from "@/lib/env";
import { httpsOrigin } from "@/lib/installer-config";
export default async function InstallPage() {
  await connection();
  let installer: string | null = null;
  try { if (process.env.SALEBELL_INSTALLER_ORIGIN) installer = httpsOrigin(process.env.SALEBELL_INSTALLER_ORIGIN); } catch { /* show sign-in only */ }
  return <main id="main" className="mx-auto w-full max-w-lg flex-1 px-4 py-20"><h1 className="text-3xl font-semibold">Your Salebell installation</h1><p className="mt-4 leading-relaxed text-muted">Finish installing your database and backend, then create your owner account. After setup, sign in to connect your first app.</p><div className="mt-6 flex gap-5 text-sm text-accent-text">{installer && <a className="underline" href={`${installer}/deploy?site=${encodeURIComponent(SITE_URL)}`}>Finish setup</a>}<Link className="underline" href="/login">Sign in</Link></div></main>;
}
