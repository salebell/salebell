#!/usr/bin/env node
// Production installation; deliberately independent of the Supabase development CLI.
import { createHmac, randomBytes } from "node:crypto";
import { chmodSync, closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { parseEnv } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DEFAULT_DIRECTORY = join(ROOT, "deploy");

export function validateOrigin(value) {
  if (typeof value !== "string" || /[\s\x00-\x1f]/.test(value)) throw new Error("Use a complete HTTPS origin without credentials, a path, query, port or fragment.");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.pathname !== "/" || url.search || url.hash
    || value.replace(/\/$/, "") !== url.origin || !url.hostname.includes(".")) {
    throw new Error("Use a complete HTTPS origin without credentials, a path, query, port or fragment.");
  }
  return url.origin;
}

export function encodeEnv(values) {
  return Object.entries(values).map(([name, raw]) => {
    const value = String(raw);
    if (value.includes("\0")) throw new Error("Environment values cannot contain NUL characters.");
    // Node and Compose both preserve multiline single-quoted PEM values literally.
    // The installer exports parsed values before invoking Compose, preventing interpolation.
    const quote = value.includes("'") ? '"' : "'";
    if (value.includes(quote)) throw new Error(`${name} cannot contain both kinds of quote. Set it through a Docker secret instead.`);
    return `${name}=${quote}${value}${quote}\n`;
  }).join("");
}

function jwt(secret, role) {
  const issued = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify({ iss: "supabase", role, iat: issued, exp: issued + 10 * 365 * 86400 })).toString("base64url");
  const signature = createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${signature}`;
}

export function initialize(directory, { siteUrl, apiUrl, email, project = "salebell" }) {
  const site = validateOrigin(siteUrl), api = validateOrigin(apiUrl);
  if (new URL(site).hostname === new URL(api).hostname) throw new Error("Site and API need different hostnames.");
  if (!/^[^\s@'"<>]+@[^\s@'"<>]+\.[^\s@'"<>]+$/.test(email ?? "")) throw new Error("Set --email to the owner's email address.");
  if (!/^[a-z0-9][a-z0-9_-]{1,48}$/.test(project)) throw new Error("Project name must contain 2–49 lowercase letters, digits, underscores or hyphens.");
  if (existsSync(join(directory, ".env")) || existsSync(join(directory, "owner-password"))) throw new Error("Already initialized. Existing secrets are retained; edit the existing .env to change settings.");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const secret = randomBytes(32).toString("hex");
  const values = {
    COMPOSE_PROJECT_NAME: project,
    SITE_URL: site,
    SITE_HOST: new URL(site).hostname,
    SUPABASE_PUBLIC_URL: api,
    API_HOST: new URL(api).hostname,
    OWNER_EMAIL: email,
    POSTGRES_PASSWORD: randomBytes(32).toString("hex"),
    JWT_SECRET: secret,
    ANON_KEY: jwt(secret, "anon"),
    SERVICE_ROLE_KEY: jwt(secret, "service_role"),
    SECRET_KEY_BASE: randomBytes(48).toString("hex"),
    REALTIME_DB_ENC_KEY: randomBytes(8).toString("hex"),
    DISABLE_SIGNUP: "true",
    SMTP_HOST: "", SMTP_PORT: "587", SMTP_USER: "", SMTP_PASS: "", SMTP_ADMIN_EMAIL: email,
    SMTP_SENDER_NAME: "Salebell",
    APNS_KEY_ID: "", APNS_TEAM_ID: "", APNS_TOPIC: "", APNS_KEY_P8: "",
    NEXT_PUBLIC_SUPPORT_EMAIL: email,
    NEXT_PUBLIC_COMPANY_NAME: "", NEXT_PUBLIC_COMPANY_NUMBER: "", NEXT_PUBLIC_COMPANY_ADDRESS: "", NEXT_PUBLIC_IOS_APP_URL: "",
  };
  writeFileSync(join(directory, ".env"), encodeEnv(values), { flag: "wx", mode: 0o600 });
  writeFileSync(join(directory, "owner-password"), `${randomBytes(30).toString("base64url")}\n`, { flag: "wx", mode: 0o600 });
  return { siteUrl: site, apiUrl: api, email };
}

function loadEnvironment(directory) {
  const envPath = join(directory, ".env");
  if (!existsSync(envPath)) throw new Error("Initialize first: npm run self-host -- init --site-url https://sales.example.com --api-url https://api.example.com --email owner@example.com");
  chmodSync(envPath, 0o600);
  const values = parseEnv(readFileSync(envPath, "utf8"));
  validateOrigin(values.SITE_URL);
  validateOrigin(values.SUPABASE_PUBLIC_URL);
  for (const key of ["POSTGRES_PASSWORD", "JWT_SECRET", "ANON_KEY", "SERVICE_ROLE_KEY", "OWNER_EMAIL", "SECRET_KEY_BASE", "REALTIME_DB_ENC_KEY"]) {
    if (!values[key]) throw new Error(`Missing ${key} in ${envPath}.`);
  }
  return { ...process.env, ...values, SALEBELL_ROOT: ROOT, SALEBELL_DEPLOY_DIR: directory };
}

function compose(directory, env, args, { capture = false, outputFile } = {}) {
  const fd = outputFile ? openSync(outputFile, "wx", 0o600) : undefined;
  try {
    const result = spawnSync("docker", ["compose", "--env-file", join(directory, ".env"), "-f", join(ROOT, "deploy/compose.yml"), ...args], {
      cwd: ROOT, env, encoding: "utf8", stdio: fd !== undefined ? ["ignore", fd, "pipe"] : capture ? "pipe" : "inherit", maxBuffer: 32 * 1024 * 1024,
    });
    if (result.error?.code === "ENOENT") throw new Error("Install Docker Engine with Docker Compose first.");
    if (result.status !== 0) throw new Error(`Docker Compose ${args[0]} failed. ${capture || fd !== undefined ? (result.stderr ?? "").slice(-2000) : "Inspect docker compose logs for the failed service."}`);
    return result.stdout;
  } finally { if (fd !== undefined) closeSync(fd); }
}

function backup(directory, env) {
  const destination = join(directory, "backups", new Date().toISOString().replace(/[:.]/g, "-"));
  mkdirSync(destination, { recursive: true, mode: 0o700 });
  compose(directory, env, ["exec", "-T", "db", "pg_dump", "-U", "supabase_admin", "-d", "postgres", "--format=custom"], { outputFile: join(destination, "database.dump") });
  compose(directory, env, ["exec", "-T", "db", "tar", "czf", "-", "-C", "/etc/postgresql-custom", "."], { outputFile: join(destination, "db-config.tar.gz") });
  copyFileSync(join(directory, ".env"), join(destination, ".env"));
  copyFileSync(join(directory, "owner-password"), join(destination, "owner-password"));
  chmodSync(join(destination, ".env"), 0o600);
  chmodSync(join(destination, "owner-password"), 0o600);
  console.log(`Backup saved to ${destination}. Protect this directory: it contains private keys and account data.`);
}

const HELP = `Usage: npm run self-host -- COMMAND [options]
  init --site-url https://sales.example.com --api-url https://api.example.com --email owner@example.com
       [--project salebell] [--directory /absolute/private/path]
  up       Build web, start private backend, migrate and create the first owner.
  check    Check authentication, database/RLS, functions and Realtime locally.
  backup   Save database, persistent Vault key material and installation secrets.
  upgrade  Back up, pull pinned images, rebuild, migrate and check the installation.
  down     Stop containers; retain all databases, keys and certificates.
  status   Show container status.
  All commands accept --directory (default: deploy/). Requires Node 22.6+ and Docker Compose.
  Point both HTTPS hostnames at the server and allow ports 80/443. Signup is closed.
  The owner password is saved in DIRECTORY/owner-password; it is never printed.
  Edit DIRECTORY/.env to configure optional SMTP and APNs before running up.`;

export function main(args = process.argv.slice(2)) {
  if (!args.length || args.includes("--help") || args.includes("-h")) { console.log(HELP); return; }
  const command = args[0];
  const options = {};
  const allowed = new Set(["--directory", "--site-url", "--api-url", "--email", "--project"]);
  for (let i = 1; i < args.length; i += 2) {
    if (!allowed.has(args[i]) || !args[i + 1] || args[i + 1].startsWith("--")) throw new Error("Unknown option or missing value. Run with --help.");
    options[args[i]] = args[i + 1];
  }
  const directory = resolve(options["--directory"] ?? DEFAULT_DIRECTORY);
  if (command === "init") {
    const install = initialize(directory, { siteUrl: options["--site-url"], apiUrl: options["--api-url"], email: options["--email"], project: options["--project"] });
    console.log(`Initialized ${install.siteUrl} (${install.email}). Secrets: ${directory}/.env; owner password: ${directory}/owner-password.\nRun npm run self-host -- up${directory !== DEFAULT_DIRECTORY ? ` --directory ${directory}` : ""}.`);
    return;
  }
  if (!["up", "check", "backup", "upgrade", "down", "status"].includes(command)) throw new Error("Unknown command. Run with --help.");
  const env = loadEnvironment(directory);
  if (command === "down") return compose(directory, env, ["down"]);
  if (command === "status") { console.log(compose(directory, env, ["ps"], { capture: true })); return; }
  if (command === "backup") return backup(directory, env);
  if (command === "check") return compose(directory, env, ["run", "--rm", "--no-deps", "bootstrap", "node", "/deploy/bootstrap.mjs", "check"]);
  if (command === "upgrade") { backup(directory, env); compose(directory, env, ["pull", "--ignore-buildable"]); }
  compose(directory, env, ["build", "web"]);
  compose(directory, env, ["up", "-d", "--wait", "--wait-timeout", "180", "db", "templates", "auth"]);
  compose(directory, env, ["run", "--rm", "--no-deps", "migrate"]);
  compose(directory, env, ["up", "-d", "--wait", "--wait-timeout", "240", "rest", "realtime", "functions", "api-gw", "web", "proxy"]);
  compose(directory, env, ["run", "--rm", "--no-deps", "bootstrap", "node", "/deploy/bootstrap.mjs", "up"]);
  console.log(`Salebell is ready at ${env.SITE_URL}. Sign in with ${env.OWNER_EMAIL} and the password in ${directory}/owner-password.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
