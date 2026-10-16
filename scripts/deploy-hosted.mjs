#!/usr/bin/env node
// Local deployment: provider login tokens remain in the official CLIs.
import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { migrationSQL, reservationSQL, settingsSQL, sqlLiteral } from "../web/lib/installer-sql.ts";
import { finishOwner, ownerInput } from "../web/lib/installer-owner.ts";
import { deploymentOrigin } from "../web/lib/installer-config.ts";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PINS = { supabase: "2.90.0", vercel: "54.20.1" };
const REF = /^[a-z0-9]{20}$/;
const NAME = /^[a-z0-9][a-z0-9-]{1,48}$/;
const PHASES = new Set(["selected", "backend", "migrations", "functions", "website", "owner", "complete"]);
const HELP = `Usage: npm run deploy -- [--check | --help]

Deploy a private Salebell instance to your own, separate Supabase and Vercel accounts.
Uses the official CLI logins already on this machine; opens login only if needed.
Missing compatible CLIs can be downloaded at pinned versions after confirmation.

The wizard selects your organization/team, creates a new Vercel project and a new
Supabase project (or uses an explicitly selected empty database), installs the
backend, sets website variables and sign-in URLs, and creates your owner login.
No Marketplace integration, shared OAuth app, Docker, custom domain, or copied
provider tokens are required. Hosting follows the plans/limits of your accounts.

Run the same command to resume using private, gitignored .salebell-deploy/state.json.
Keep the same checkout until setup finishes. Passwords and provider keys are never
stored in that checkpoint. Existing app databases are rejected; this is not an upgrade tool.
--check checks CLI authentication and release assets without changing provider resources.
Requires Node.js 22.6+ and an interactive terminal for installation.`;

export class DeployError extends Error {
  constructor(message, authentication = false) { super(message); this.authentication = authentication; }
}
export function parseJSON(text) {
  try { return JSON.parse(text.trim()); } catch { throw new DeployError("The provider CLI returned an unexpected response. Update the CLI or retry."); }
}
export function rows(result) { return Array.isArray(result) ? result : Array.isArray(result?.rows) ? result.rows : []; }
export function publicConnection(keys) {
  const usable = keys.filter(key => typeof key.api_key === "string" && key.api_key.length > 10 && !key.api_key.includes("*"));
  const publicKey = usable.find(key => key.type === "publishable")?.api_key ?? usable.find(key => key.name === "anon")?.api_key;
  const adminKey = usable.find(key => key.type === "secret")?.api_key ?? usable.find(key => key.name === "service_role")?.api_key;
  if (!publicKey || !adminKey || publicKey === adminKey) throw new DeployError("Supabase did not return usable public and admin keys. Check your CLI login and project permissions.");
  return { publicKey, adminKey };
}
export function hostedMigrationSQL(asset) {
  const sql = migrationSQL(asset);
  const version = asset.name.slice(0, 14), name = asset.name.slice(15, -4);
  const history = `create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations(version text primary key, statements text[], name text);
insert into supabase_migrations.schema_migrations(version, statements, name)
values (${sqlLiteral(version)}, array[${sqlLiteral(asset.sql)}], ${sqlLiteral(name)}) on conflict(version) do nothing;`;
  // Keep the application checksum and normal Supabase CLI history atomic.
  // A replacement string interprets $$, $& and $' inside SQL as JS substitutions.
  // Return it from a callback so migration functions/regexes remain byte-for-byte intact.
  return sql.replace(/\ncommit;$/, () => `\n${history}\ncommit;`);
}
export function hostedConfig(origin, functions = []) {
  const quote = JSON.stringify;
  return `project_id = "salebell"
# Fresh-project API/Auth baseline; config push also checks API and database config.
[api]
enabled = true
schemas = ["public", "graphql_public"]
extra_search_path = ["public", "extensions"]
max_rows = 1000
[auth]
enabled = true
site_url = ${quote(origin)}
additional_redirect_urls = [${quote(origin + "/**")}]
enable_signup = false
[auth.email]
enable_signup = true
enable_confirmations = false
otp_length = 6
otp_expiry = 900
[storage]
enabled = false
` + functions.map(fn => `\n[functions.${fn.slug}]\nverify_jwt = ${fn.verifyJwt}\n`).join("");
}
export function copyWebSource(source, target) {
  mkdirSync(target, { recursive: true, mode: 0o700 });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (entry.isSymbolicLink() || ["node_modules", ".next", ".git", ".vercel", ".salebell-deploy"].includes(entry.name) || entry.name.startsWith(".env") || /\.(log|pem|key|p8|dump)$/.test(entry.name)) continue;
    const from = join(source, entry.name), to = join(target, entry.name);
    if (entry.isDirectory()) copyWebSource(from, to);
    else if (entry.isFile()) copyFileSync(from, to);
  }
}
function saveState(directory, state) {
  mkdirSync(directory, { recursive: true, mode: 0o700 }); chmodSync(directory, 0o700);
  const pending = join(directory, "state.json.tmp");
  if (existsSync(pending) && lstatSync(pending).isSymbolicLink()) throw new DeployError("The deployment checkpoint path must not be a symbolic link.");
  writeFileSync(pending, JSON.stringify(state, null, 2) + "\n", { mode: 0o600 }); chmodSync(pending, 0o600);
  renameSync(pending, join(directory, "state.json"));
}
function loadState(directory, release) {
  const path = join(directory, "state.json");
  if (!existsSync(path)) return null;
  if (lstatSync(directory).isSymbolicLink() || lstatSync(path).isSymbolicLink()) throw new DeployError("The deployment checkpoint must not be a symbolic link.");
  const state = parseJSON(readFileSync(path, "utf8"));
  if (state.release !== release.id) throw new DeployError("This checkout differs from the installation checkpoint. Resume using the original checkout; don't apply a new release over an unfinished installation.");
  if (!/^[a-f0-9-]{36}$/i.test(state.id) || !NAME.test(state.name) || !PHASES.has(state.phase) || !state.org?.id || !state.scope?.id || !state.scope?.slug || (state.supabaseRef && !REF.test(state.supabaseRef))) throw new DeployError("The deployment checkpoint is invalid. Keep it for recovery; do not select a live database as a fresh installation.");
  return state;
}

export class ProviderCLI {
  constructor(commands, cwd) { this.commands = commands; this.cwd = cwd; }
  async run(tool, args, { input = "", interactive = false, label = tool, cwd = this.cwd } = {}) {
    const [file, ...prefix] = this.commands[tool];
    const env = { ...process.env };
    // Never let a caller's unrelated linked-project overrides select our target.
    delete env.VERCEL_PROJECT_ID; delete env.VERCEL_ORG_ID; delete env.SUPABASE_WORKDIR;
    return new Promise((resolveRun, reject) => {
      const child = spawn(file, [...prefix, ...args], { cwd, env, shell: false, stdio: interactive ? "inherit" : ["pipe", "pipe", "pipe"] });
      let out = "", err = "";
      if (!interactive) {
        child.stdout.on("data", data => { out += data; if (out.length > 64 * 1024 * 1024) child.kill(); });
        child.stderr.on("data", data => { err = (err + data).slice(-16384); });
        child.stdin.on("error", () => {}); child.stdin.end(input);
      }
      const timer = setTimeout(() => child.kill(), 15 * 60_000);
      child.on("error", () => { clearTimeout(timer); reject(new DeployError(`${label} could not start. Check the CLI installation.`)); });
      child.on("close", code => {
        clearTimeout(timer);
        if (code === 0) resolveRun(out);
        else {
          const authentication = /access token not provided|not logged in|no existing credentials|invalid access token|unauthorized|401/i.test(err);
          const known = err.match(/\b(project_not_empty|installation_conflict|migration_conflict)\b/)?.[1];
          // Never echo raw provider stdout/stderr: API-key output and HTTP errors may contain secrets.
          reject(new DeployError(known ?? `${label} failed. Check the selected account's permissions and limits, then rerun to resume.`, authentication));
        }
      });
    });
  }
  async json(tool, args, options) { return parseJSON(await this.run(tool, args, options)); }
}
async function line(prompt) {
  const reader = createInterface({ input: process.stdin, output: process.stdout });
  try { return (await reader.question(prompt)).trim(); } finally { reader.close(); }
}
async function hidden(prompt) {
  if (!process.stdin.isTTY) throw new DeployError("Owner password entry needs an interactive terminal.");
  process.stdout.write(prompt);
  const input = process.stdin, previous = input.isRaw;
  input.setRawMode(true); input.resume();
  return new Promise((resolveSecret, reject) => {
    let value = "";
    const cleanup = () => { input.off("data", receive); input.setRawMode(previous); input.pause(); process.stdout.write("\n"); };
    const receive = bytes => {
      for (const character of bytes.toString()) {
        if (character === "\u0003") { cleanup(); reject(new DeployError("Setup interrupted. Run the command again to resume.")); return; }
        if (character === "\r" || character === "\n") { cleanup(); resolveSecret(value); return; }
        if (character === "\u007f" || character === "\b") value = value.slice(0, -1);
        else if (character >= " " && value.length < 128) value += character;
      }
    };
    input.on("data", receive);
  });
}
export const terminalUI = {
  log: message => console.log(message),
  async confirm(message) { return /^(y|yes)$/i.test(await line(message + " [y/N] ")); },
  async choose(message, choices) {
    if (!choices.length) throw new DeployError("No available organization or team. Create one in your provider account first.");
    if (choices.length === 1) { console.log(`${message}: ${choices[0].label}`); return choices[0].value; }
    console.log(message); choices.forEach((choice, i) => console.log(`  ${i + 1}. ${choice.label}`));
    for (;;) { const index = Number(await line("Choose a number: ")) - 1; if (Number.isInteger(index) && choices[index]) return choices[index].value; }
  },
  async email() { return line("Owner email: "); },
  async password() {
    const password = await hidden("Owner password (12–128 characters): ");
    if (password !== await hidden("Confirm owner password: ")) throw new DeployError("Passwords differ. Rerun to resume setup.");
    return password;
  },
};
export async function prepareCLI(cwd, ui = terminalUI) {
  const commands = {}, missing = [];
  for (const [tool, pin] of Object.entries(PINS)) {
    const result = spawnSync(tool, ["--version"], { cwd, encoding: "utf8", env: process.env });
    const version = result.status === 0 ? result.stdout.match(/\b(\d+)\.(\d+)\.(\d+)\b/) : null;
    const minimum = pin.split(".").map(Number);
    const compatible = version && version.slice(1).map(Number).some((part, i, all) => all.slice(0, i).every((v, j) => v === minimum[j]) && part > minimum[i]) || version && version.slice(1).every((part, i) => Number(part) === minimum[i]);
    if (compatible) commands[tool] = [tool];
    else { commands[tool] = [process.platform === "win32" ? "npx.cmd" : "npx", "--yes", `--package=${tool}@${pin}`, tool]; missing.push(`${tool}@${pin}`); }
  }
  if (missing.length && !await ui.confirm(`Download official CLI packages ${missing.join(" and ")} into npm's cache?`)) throw new DeployError("Install compatible provider CLIs, then rerun npm run deploy.");
  return new ProviderCLI(commands, cwd);
}
async function logins(cli, ui, check) {
  const authenticate = async (tool, args) => {
    try { return await cli.json(tool, args, { label: `${tool} account check` }); }
    catch (error) {
      if (check || !error.authentication) throw error;
      ui.log(`Sign in to your ${tool} account in the official CLI.`);
      await cli.run(tool, ["login"], { interactive: true, label: `${tool} login` });
      return cli.json(tool, args, { label: `${tool} account check` });
    }
  };
  const orgs = rows(await authenticate("supabase", ["orgs", "list", "--output=json", "--agent=no"]));
  const identity = await authenticate("vercel", ["whoami", "--format=json", "--non-interactive"]);
  const teamsResult = await cli.json("vercel", ["teams", "ls", "--format=json", "--non-interactive"], { label: "Vercel team listing" });
  const teams = teamsResult.teams ?? teamsResult.context?.teams ?? [];
  // whoami's JSON varies by CLI: /v2/user provides the authenticated account ID.
  const userResult = await cli.json("vercel", ["api", "/v2/user", "--raw"], { label: "Vercel account details" });
  const user = userResult.user;
  if (!user?.id || !user.username || !Array.isArray(teams)) throw new DeployError("Vercel returned incomplete account details.");
  ui.log(`Signed in to Vercel as ${user.username}. Supabase organizations: ${orgs.length}.`);
  return { orgs, scopes: [{ id: user.id, slug: user.username, name: `${user.username} (personal account)` }, ...teams.map(team => ({ id: team.id, slug: team.slug, name: team.name ?? team.slug }))], identity };
}

export async function deployHosted({ root = ROOT, directory = join(root, ".salebell-deploy"), workdir, cli, ui = terminalUI, release, fetcher = fetch, sleep = ms => new Promise(done => setTimeout(done, ms)), check = false } = {}) {
  const assets = release ?? parseJSON(readFileSync(join(root, "web/installer/release.json"), "utf8"));
  const accounts = await logins(cli, ui, check);
  if (check) { ui.log("Provider CLI logins and release assets are available. No provider resources were changed."); return; }
  let state = loadState(directory, assets);
  const checkpoint = () => saveState(directory, state);
  const sb = (args, options) => cli.json("supabase", [...args, "--output=json", "--agent=no", "--workdir", workdir], options);
  const api = (path, body, label = "Vercel project configuration") => cli.json("vercel", ["api", path, "--raw", ...(body === undefined ? [] : ["--method", "POST", "--input", "-"])], { input: body === undefined ? "" : JSON.stringify(body), label });
  const projects = () => sb(["projects", "list"], { label: "Supabase project listing" });
  if (!state) {
    const org = await ui.choose("Supabase organization", accounts.orgs.map(org => ({ label: org.name ?? org.id, value: { id: org.id, slug: org.slug ?? org.id, name: org.name ?? org.id } })));
    const scope = await ui.choose("Vercel account/team", accounts.scopes.map(scope => ({ label: scope.name, value: scope })));
    const available = rows(await projects()).filter(project => [project.organization_id, project.organization_slug].includes(org.id) || [project.organization_id, project.organization_slug].includes(org.slug));
    const existing = await ui.choose("Supabase backend", [{ label: "Create a new project", value: null }, ...available.map(project => ({ label: `${project.name} (${project.id}) — must be empty`, value: project.id }))]);
    const id = randomUUID(), name = `salebell-${id.slice(0, 8)}`;
    ui.log(`Deployment: ${name}\nSupabase: ${org.name}${existing ? ` / ${existing}` : " / new project"}\nVercel: ${scope.name} / new project\nProvider plans and resource limits apply independently.`);
    if (!await ui.confirm("Create and configure this Salebell installation?")) throw new DeployError("Setup canceled before any provider changes.");
    state = { id, name, release: assets.id, org, scope, phase: "selected", supabaseRef: existing ?? undefined, createdAt: Date.now() };
    checkpoint();
  } else {
    if (!accounts.orgs.some(org => org.id === state.org.id || org.slug === state.org.slug) || !accounts.scopes.some(scope => scope.id === state.scope.id)) throw new DeployError("The saved installation belongs to different provider accounts. Sign in to the original accounts to resume.");
    ui.log(`Resuming ${state.name} (${state.phase}).`);
  }
  if (!state.supabaseRef) {
    if (state.creatingSupabase) throw new DeployError("The Supabase creation response was interrupted. Check your organization's projects before starting another installation; no existing project will be adopted automatically.");
    state.creatingSupabase = true; checkpoint();
    ui.log("Creating your Supabase project…");
    // The pinned CLI generates a random database password when this explicitly
    // empty flag is supplied with EOF on stdin. No password is put in argv/logs.
    const created = await sb(["projects", "create", state.name, "--org-id", state.org.id, "--region", "eu-west-2", "--db-password="], { input: "", label: "Supabase project creation" });
    const project = Array.isArray(created) ? created[0] : created;
    if (!REF.test(project?.id ?? "")) throw new DeployError("Supabase creation returned no project ID. Inspect the provider dashboard before retrying.");
    state.supabaseRef = project.id; state.creatingSupabase = false; checkpoint();
  }
  let database;
  for (let attempt = 0; attempt < 60; attempt++) {
    database = rows(await projects()).find(project => project.id === state.supabaseRef);
    if (!database || ![database.organization_id, database.organization_slug].some(id => id === state.org.id || id === state.org.slug)) throw new DeployError("The saved Supabase project doesn't belong to the selected organization.");
    if (database.status === "ACTIVE_HEALTHY") break;
    if (attempt === 59) throw new DeployError("Supabase is still starting. Rerun this command in a few minutes to resume.");
    if (attempt % 6 === 0) ui.log("Waiting for Supabase to become ready…");
    await sleep(10_000);
  }
  mkdirSync(join(workdir, "supabase/.temp"), { recursive: true, mode: 0o700 });
  writeFileSync(join(workdir, "supabase/.temp/project-ref"), state.supabaseRef, { mode: 0o600 });
  const configPath = join(workdir, "supabase/config.toml");
  const query = async sql => {
    const file = join(workdir, "query.sql"); writeFileSync(file, sql, { mode: 0o600 });
    try { return rows(await sb(["db", "query", "--linked", "--file", file], { label: "Supabase database setup" })); }
    finally { rmSync(file, { force: true }); }
  };
  const configure = async origin => {
    writeFileSync(configPath, hostedConfig(origin, assets.functions), { mode: 0o600 });
    await cli.run("supabase", ["config", "push", "--project-ref", state.supabaseRef, "--workdir", workdir, "--agent=no", "--yes"], { label: "Supabase sign-in and API configuration" });
  };
  // Validate ownership and emptiness before ANY configuration changes, including on resume.
  const reservation = await query("select to_regclass('private.browser_installation') as installed");
  if (reservation[0]?.installed) await query(reservationSQL(state.id, assets.id));
  else {
    const occupied = await query("select exists(select 1 from auth.users) or exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private') and c.relkind in ('r','p','v','m') and not exists(select 1 from pg_depend d where d.objid=c.oid and d.deptype='e')) as occupied");
    const functions = rows(await sb(["functions", "list", "--project-ref", state.supabaseRef], { label: "Supabase function listing" }));
    if (occupied[0]?.occupied !== false || functions.length) throw new DeployError("project_not_empty: choose a new Supabase project; existing app data and users are preserved.");
    await configure("https://setup.invalid");
    await query(reservationSQL(state.id, assets.id));
  }
  if (state.phase === "selected") { state.phase = "backend"; checkpoint(); }
  if (["backend", "migrations"].includes(state.phase)) {
    state.phase = "migrations"; checkpoint(); ui.log("Installing the database…");
    for (const migration of assets.migrations) await query(hostedMigrationSQL(migration));
    await query(settingsSQL(state.supabaseRef));
    state.phase = "functions"; checkpoint();
  }
  if (state.phase === "functions") {
    ui.log("Deploying backend functions…");
    writeFileSync(configPath, hostedConfig("https://setup.invalid", assets.functions), { mode: 0o600 });
    for (const fn of assets.functions) {
      for (const file of fn.files) {
        const path = join(workdir, "supabase/functions", file.name);
        mkdirSync(dirname(path), { recursive: true, mode: 0o700 }); writeFileSync(path, file.content, { mode: 0o600 });
      }
      await cli.run("supabase", ["functions", "deploy", fn.slug, "--project-ref", state.supabaseRef, "--workdir", workdir, "--use-api", "--yes", "--agent=no"], { label: `Supabase function ${fn.slug}` });
    }
    state.phase = "website"; checkpoint();
  }
  const { publicKey, adminKey } = publicConnection(rows(await sb(["projects", "api-keys", "--project-ref", state.supabaseRef], { label: "Supabase connection settings" })));
  const values = { NEXT_PUBLIC_SUPABASE_URL: `https://${state.supabaseRef}.supabase.co`, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publicKey, NEXT_PUBLIC_DEPLOYMENT_MODE: "self_hosted", SALEBELL_BROWSER_INSTALL: "false", INSTALLER_ENABLED: "false", INSTALLER_PUBLIC_ENABLED: "false" };
  if (!state.vercelId) {
    if (state.creatingVercel) throw new DeployError("The Vercel creation response was interrupted. Check the selected account before starting another installation; no existing project will be adopted automatically.");
    state.creatingVercel = true; checkpoint(); ui.log("Creating your Vercel website…");
    const project = await api(`/v11/projects?teamId=${encodeURIComponent(state.scope.id)}`, { name: state.name, framework: "nextjs", rootDirectory: "web", environmentVariables: Object.entries(values).map(([key, value]) => ({ key, value, target: ["production"], type: "plain" })) }, "Vercel project creation");
    if (!project.id || project.accountId !== state.scope.id) throw new DeployError("Vercel returned a project outside the selected account.");
    state.vercelId = project.id; state.creatingVercel = false; checkpoint();
  }
  const projectPath = `/v9/projects/${encodeURIComponent(state.vercelId)}?teamId=${encodeURIComponent(state.scope.id)}`;
  const verified = await api(projectPath);
  if (verified.id !== state.vercelId || verified.accountId !== state.scope.id || verified.rootDirectory !== "web") throw new DeployError("The saved Vercel project no longer matches this installation's account and root directory.");
  if (state.phase === "website") {
    copyWebSource(join(root, "web"), join(workdir, "web"));
    mkdirSync(join(workdir, ".vercel"), { mode: 0o700 });
    writeFileSync(join(workdir, ".vercel/project.json"), JSON.stringify({ projectId: state.vercelId, orgId: state.scope.id, projectName: state.name }), { mode: 0o600 });
    writeFileSync(join(workdir, ".vercelignore"), "/*\n!/web\n/web/node_modules\n/web/.next\n/web/.env*\n");
    ui.log("Building and deploying your website…");
    const result = await cli.json("vercel", ["deploy", "--prod", "--yes", "--non-interactive", "--format=json", "--project", state.vercelId, "--scope", state.scope.slug], { cwd: workdir, label: "Vercel production deployment" });
    const deployment = result.deployment ?? result;
    if (!deployment.id || deployment.readyState !== "READY") throw new DeployError("Vercel deployment isn't ready. Check its build log, then rerun to resume.");
    state.deploymentId = deployment.id; checkpoint();
    const domains = await api(`/v9/projects/${encodeURIComponent(state.vercelId)}/domains?teamId=${encodeURIComponent(state.scope.id)}`);
    const domain = domains.domains?.find(domain => !domain.redirect && /^[a-z0-9-]+\.vercel\.app$/i.test(domain.name));
    if (!domain) throw new DeployError("Vercel hasn't assigned the production domain yet. Rerun to resume.");
    state.origin = deploymentOrigin(`https://${domain.name}`); checkpoint();
    await configure(state.origin);
    await cli.run("supabase", ["secrets", "set", `SITE_URL=${state.origin}`, "--project-ref", state.supabaseRef, "--workdir", workdir], { label: "Supabase website origin" });
    await api(`/v10/projects/${encodeURIComponent(state.vercelId)}/env?teamId=${encodeURIComponent(state.scope.id)}&upsert=true`, { key: "NEXT_PUBLIC_SITE_URL", value: state.origin, target: ["production"], type: "plain" });
    state.phase = "owner"; checkpoint();
  }
  const origin = deploymentOrigin(state.origin);
  const healthResponse = await fetcher(`${origin}/api/instance-health`, { redirect: "error", signal: AbortSignal.timeout(30_000) });
  if (!healthResponse.ok) throw new DeployError("The public website health check failed. Check production deployment protection and rerun to resume.");
  const health = await healthResponse.json();
  if (health.release !== assets.id || health.mode !== "self_hosted" || health.origin !== origin) throw new DeployError("The website release or production address doesn't match this installation.");
  const webhook = await fetcher(`${origin}/hooks/apple/notarealkey1/production`, { method: "POST", body: "{}", headers: { "content-type": "application/json" }, redirect: "error", signal: AbortSignal.timeout(30_000) });
  await webhook.body?.cancel();
  if (webhook.status !== 404) throw new DeployError("The Apple notification route didn't reach the backend. Check Vercel and rerun to resume.");
  if (state.phase === "complete") { ui.log(`Salebell is ready: ${origin}/login`); return state; }
  if (!state.ownerEmail) {
    const email = await ui.email(); ownerInput(email, "validation-password"); state.ownerEmail = email.trim().toLowerCase(); checkpoint();
  }
  ui.log(`Create or verify the owner login for ${state.ownerEmail}.`);
  const password = await ui.password(); ownerInput(state.ownerEmail, password);
  const job = { id: state.id, version: 0, phase: "owner", createdAt: state.createdAt, expiresAt: Date.now() + 600_000, cursor: 0, ownerEmail: state.ownerEmail, target: { projectName: state.name, supabaseRef: state.supabaseRef, supabaseName: database.name, publicKey, origin } };
  const completed = await finishOwner(job, state.ownerEmail, password, adminKey, fetcher);
  state.ownerId = completed.ownerId; state.phase = "complete"; checkpoint();
  ui.log(`Salebell is ready: ${origin}/login\nSign in as ${state.ownerEmail}, then connect your first app.`);
  return state;
}

export async function main(args = process.argv.slice(2)) {
  if (args.includes("--help") || args.includes("-h")) { console.log(HELP); return; }
  if (args.some(arg => arg !== "--check")) throw new DeployError("Unknown option. Run npm run deploy -- --help.");
  const check = args.includes("--check");
  if (!check && (!process.stdin.isTTY || !process.stdout.isTTY)) throw new DeployError("Run npm run deploy in an interactive terminal. Use --check for read-only validation.");
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || major === 22 && minor < 6) throw new DeployError("Use Node.js 22.6 or newer.");
  const checked = spawnSync(process.execPath, [join(ROOT, "web/scripts/build-installer-assets.mjs"), "--check"], { cwd: ROOT, stdio: "pipe" });
  if (checked.status !== 0) throw new DeployError("Release assets are stale. Run npm run installer:assets, then rerun deployment.");
  const workdir = mkdtempSync(join(tmpdir(), "salebell-deploy-")); chmodSync(workdir, 0o700);
  try { const cli = await prepareCLI(workdir); return await deployHosted({ workdir, cli, check }); }
  finally { rmSync(workdir, { recursive: true, force: true }); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main().catch(error => { console.error(error instanceof DeployError ? error.message : "Setup couldn't finish. Your checkpoint is retained; rerun npm run deploy to resume."); process.exitCode = 1; });
}
