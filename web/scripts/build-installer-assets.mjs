import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const sha = value => createHash("sha256").update(value).digest("hex");
const fnRoot = join(root, "supabase/functions");
const config = readFileSync(join(root, "supabase/config.toml"), "utf8");
const allowed = ["apple-webhook", "apple-connect", "apple-credentials", "apple-test", "test-alert", "delete-account", "fx-refresh", "google-webhook", "google-connect"];
function files(directory, prefix = "") {
  return readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => {
    const name = prefix + entry.name;
    if (entry.isDirectory()) return files(join(directory, entry.name), name + "/");
    if (!entry.isFile() || !/\.(ts|tsx|json)$/.test(name)) return [];
    return [{ name, content: readFileSync(join(directory, entry.name), "utf8") }];
  });
}
const shared = files(join(fnRoot, "_shared"), "_shared/");
const functions = allowed.map(slug => {
  const section = config.match(new RegExp(`\\[functions\\.${slug}\\]([\\s\\S]*?)(?=\\n\\[|$)`))?.[1];
  if (!section || !/verify_jwt\s*=\s*(true|false)/.test(section)) throw new Error(`Missing JWT configuration for ${slug}`);
  return { slug, verifyJwt: /verify_jwt\s*=\s*true/.test(section), files: [...files(join(fnRoot, slug), slug + "/"), ...shared] };
});
const migrations = readdirSync(join(root, "supabase/migrations")).filter(name => /^\d{14}_[a-zA-Z0-9_]+\.sql$/.test(name)).sort().map(name => {
  const sql = readFileSync(join(root, "supabase/migrations", name), "utf8");
  return { name, sha256: sha(sql), sql };
});
const payload = { migrations, functions };
const webRoot = join(root, "web");
const webFiles = ["app", "lib", "components"].flatMap(directory => files(join(webRoot, directory), directory + "/"))
  .filter(file => !file.name.endsWith(".test.ts"));
for (const name of ["next.config.ts", "proxy.ts", "package.json", "app/globals.css"]) webFiles.push({ name, content: readFileSync(join(webRoot, name), "utf8") });
const webFingerprint = sha(JSON.stringify(webFiles));
const release = { id: sha(JSON.stringify({ ...payload, webFingerprint })), ...payload };
const destination = join(root, "web/installer/release.json");
mkdirSync(dirname(destination), { recursive: true });
const output = JSON.stringify(release) + "\n";
if (process.argv.includes("--check")) {
  if (readFileSync(destination, "utf8") !== output) throw new Error("Installer release assets are stale. Run npm run installer:assets.");
} else writeFileSync(destination, output);
console.log(`Installer assets: ${migrations.length} migrations, ${functions.length} functions, release ${release.id.slice(0, 12)}`);
