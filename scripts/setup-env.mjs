// Parse an explicitly selected credentials file as data; never execute its contents.
import { readFileSync, realpathSync } from "node:fs";
import { parseEnv } from "node:util";
import { pathToFileURL } from "node:url";

const ALLOWED = new Set([
  "SUPABASE_PROJECT_REF", "SITE_URL", "SUPABASE_ACCESS_TOKEN", "RESEND_API_KEY", "SENDER_EMAIL",
  "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "APNS_KEY_FILE", "APNS_KEY_ID", "APPLE_TEAM_ID", "APNS_TOPIC",
]);

export function readSetupEnv(contents) {
  return Object.entries(parseEnv(contents)).filter(([name]) => ALLOWED.has(name));
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  try {
    for (const [name, value] of readSetupEnv(readFileSync(process.argv[2], "utf8"))) {
      if (value.includes("\0")) throw new Error("Setup values cannot contain NUL characters.");
      process.stdout.write(`${name}\0${value}\0`);
    }
  } catch {
    console.error("Could not parse the setup env file. Use the dotenv format in .env.setup.example.");
    process.exitCode = 1;
  }
}
