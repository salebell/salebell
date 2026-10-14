#!/usr/bin/env node
// One command for a local database, migrations, function runtime and web app.
import { existsSync, readFileSync, writeFileSync, realpathSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { parseEnv } from "node:util";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
// Keep npm/Next on the Node runtime that passed the version check, even with per-directory version managers.
const RUNTIME_ENV = { ...process.env, PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH || ""}` };
const npmCommand = process.env.npm_execpath ? process.execPath : "npm";
const npmArgs = (args) => process.env.npm_execpath ? [process.env.npm_execpath, ...args] : args;

export function localEnvironment(status, deploymentMode = "self_hosted") {
  if (!["cloud", "self_hosted"].includes(deploymentMode)) throw new Error("Invalid local deployment mode.");
  const url = status.API_URL;
  const key = status.PUBLISHABLE_KEY || status.ANON_KEY;
  if (!url || !key) throw new Error("Local Supabase returned no API URL or public key. Run supabase status to check the stack.");
  if (!isLocalUrl(url)) throw new Error("Supabase status returned a hosted URL. This command only starts local development.");
  return {
    NEXT_PUBLIC_SUPABASE_URL: url,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key,
    NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
    NEXT_PUBLIC_DEPLOYMENT_MODE: deploymentMode,
  };
}

function isLocalUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  } catch { return false; }
}

export function updateLocalEnv(existing, values) {
  const previous = parseEnv(existing);
  for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SITE_URL"]) {
    if (previous[key] && !isLocalUrl(previous[key])) {
      throw new Error(`web/.env.local has a hosted ${key}. Move that file aside and run npm run dev again to create a local configuration.`);
    }
  }
  let content = existing;
  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${value}`;
    const pattern = new RegExp(`^(?:export\\s+)?${key}\\s*=.*$`, "gm");
    if (pattern.test(content)) content = content.replace(pattern, () => line);
    else content += `${content && !content.endsWith("\n") ? "\n" : ""}${line}\n`;
  }
  return content;
}

function run(command, args, { capture = false, ...options } = {}) {
  const result = spawnSync(command, args, { cwd: ROOT, encoding: "utf8", stdio: capture ? "pipe" : "inherit", ...options });
  if (result.error?.code === "ENOENT") throw new Error(`${command} is missing. See README.md → Develop locally for prerequisites.`);
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed.${capture ? `\n${result.stderr || ""}` : ""}`);
  return result.stdout;
}

export async function main(args = process.argv.slice(2)) {
  if (args.includes("--help")) {
    console.log("Usage: npm run dev [-- --setup-only] [--cloud]\nStarts local Supabase, applies pending local migrations, writes web/.env.local and runs functions + web.\nDefaults to self-hosted full access. --cloud tests local cloud Free/Pro behavior.\n--setup-only prepares the local stack and env, then exits. Hosted services are never configured.");
    return;
  }
  if (args.some((arg) => !["--setup-only", "--cloud"].includes(arg))) throw new Error("Unknown argument. Run npm run dev -- --help.");
  const deploymentMode = args.includes("--cloud") ? "cloud" : "self_hosted";
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 6)) throw new Error("Use Node.js 22.6 or newer.");

  // Reject a hosted config before starting containers or installing packages.
  const envPath = join(ROOT, "web/.env.local");
  const existing = existsSync(envPath) ? readFileSync(envPath, "utf8") : readFileSync(join(ROOT, "web/.env.local.example"), "utf8");
  updateLocalEnv(existing, {});
  run("supabase", ["--version"], { capture: true });
  try { run("docker", ["info"], { capture: true }); }
  catch { throw new Error("Docker is not running. Start Docker Desktop (or a compatible Docker daemon), then run npm run dev again."); }

  if (!existsSync(join(ROOT, "web/node_modules/.bin/next"))) run(npmCommand, npmArgs(["ci", "--prefix", "web"]), { env: RUNTIME_ENV });
  console.log("Starting local Supabase (first run downloads its containers)…");
  run("supabase", ["start"]);
  run("supabase", ["migration", "up", "--local"]);
  run("supabase", ["db", "query", "--local", `update private.instance_settings set deployment_mode = '${deploymentMode}' where singleton;`], { capture: true });
  const values = localEnvironment(JSON.parse(run("supabase", ["status", "-o", "json"], { capture: true })), deploymentMode);
  writeFileSync(envPath, updateLocalEnv(existing, values), { mode: 0o600 });
  console.log("Local configuration ready. At http://localhost:3000 choose 'Email me a code instead'; read codes at http://127.0.0.1:54324.\nSupabase Studio: http://127.0.0.1:54323. Stop containers later with npm run dev:stop.");
  if (args.includes("--setup-only")) return;

  // Explicit values also override shell env and Next's .env.development.local.
  const children = [
    spawn("supabase", ["functions", "serve"], { cwd: ROOT, stdio: "inherit", detached: process.platform !== "win32" }),
    spawn(npmCommand, npmArgs(["--prefix", "web", "run", "dev", "--", "--port", "3000"]), { cwd: ROOT, stdio: "inherit", env: { ...RUNTIME_ENV, ...values }, detached: process.platform !== "win32" }),
  ];
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    for (const child of children) if (child.exitCode === null && child.pid) {
      try {
        if (process.platform === "win32") child.kill("SIGTERM");
        else process.kill(-child.pid, "SIGTERM");
      } catch (error) { if (error.code !== "ESRCH") throw error; }
    }
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  await Promise.all(children.map((child) => new Promise((resolve) => {
    child.once("error", (error) => { console.error(error.message); process.exitCode = 1; stop(); resolve(); });
    child.once("exit", (code) => { if (!stopping && code) process.exitCode = code; stop(); resolve(); });
  })));
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main().catch((error) => { console.error(`\n${error.message}`); process.exitCode = 1; });
}
