#!/usr/bin/env bash
# Explicit hosted owner setup. Local development: npm run dev.
set -euo pipefail
cd "$(dirname "$0")/.."

usage() {
  cat <<'HELP'
Usage: npm run setup:owner -- --project-ref REF --site-url https://your-site [options]

  --env-file FILE       Read credentials as dotenv data (never shell code).
  --steps LIST          Comma-separated auth,email,stripe,push (default: all).
  --yes                 Apply selected steps without prompts; skip steps with missing credentials.
                        Requires an explicit --env-file.
  --check               Validate target and show which selected steps have credentials; no remote changes.
  --help                Show this help.

The target can also be set as SUPABASE_PROJECT_REF and SITE_URL in the explicit env file.
No env file is loaded automatically. See docs/SETUP.md and .env.setup.example.
HELP
}
fail() { printf '%s\n' "$1" >&2; exit 1; }
need_value() { [[ $# -ge 2 && -n $2 && $2 != --* ]] || fail "Missing value for $1."; }
AUTO=0 CHECK=0 ENV_FILE= CLI_REF= CLI_SITE= STEPS=auth,email,stripe,push
while (($#)); do
  case $1 in
    --help|-h) usage; exit 0 ;;
    --env-file) need_value "$@"; ENV_FILE=$2; shift 2 ;;
    --project-ref) need_value "$@"; CLI_REF=$2; shift 2 ;;
    --site-url) need_value "$@"; CLI_SITE=$2; shift 2 ;;
    --steps) need_value "$@"; STEPS=$2; shift 2 ;;
    --yes) AUTO=1; shift ;;
    --check) CHECK=1; shift ;;
    *) fail "Unknown option: $1. Use --help." ;;
  esac
done
command -v node >/dev/null || fail "Install Node.js 22.6+ first. See README.md."
node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major < 22 || (major === 22 && minor < 6) ? 1 : 0)' || fail "Use Node.js 22.6 or newer for owner setup."
TMP_SETUP=$(mktemp -d)
chmod 700 "$TMP_SETUP"
trap 'rm -rf "$TMP_SETUP"' EXIT
if [[ -n $ENV_FILE ]]; then
  [[ -f $ENV_FILE ]] || fail "Env file not found: $ENV_FILE"
  node scripts/setup-env.mjs "$ENV_FILE" > "$TMP_SETUP/values"
  while IFS= read -r -d '' name && IFS= read -r -d '' value; do export "$name=$value"; done < "$TMP_SETUP/values"
fi
REF=${CLI_REF:-${SUPABASE_PROJECT_REF:-}}
SITE_URL=${CLI_SITE:-${SITE_URL:-}}
BUNDLE_ID=${APNS_TOPIC:-com.salebell.salebell}
[[ $REF =~ ^[a-z0-9]{20}$ ]] || fail "Set --project-ref to your 20-character Supabase project ref (or SUPABASE_PROJECT_REF in --env-file)."
export SITE_URL
node -e 'const u = new URL(process.env.SITE_URL); if (u.protocol !== "https:" || u.username || u.password || u.pathname !== "/" || u.search || u.hash) process.exit(1)' 2>/dev/null || fail "Set --site-url to your HTTPS site origin, for example https://salebell.vercel.app."
SITE_URL=${SITE_URL%/}
export SITE_URL
IFS=',' read -r -a selected_steps <<< "$STEPS"
((${#selected_steps[@]})) || fail "Select at least one step."
for step in "${selected_steps[@]}"; do
  case $step in auth|email|stripe|push) ;; *) fail "Unknown step: $step. Choose auth,email,stripe,push." ;; esac
done
((!AUTO)) || [[ -n $ENV_FILE ]] || fail "--yes requires an explicit --env-file."

selected() { [[ ,$STEPS, == *,$1,* ]]; }
credentials() {
  local v
  for v in "$@"; do [[ -n ${!v:-} ]] || return 1; done
}
bold() { printf '\n\033[1m%s\033[0m\n' "$1"; }
ask() { local a; read -rp "$1 [y/N] " a; [[ $a == [yY]* ]]; }
go() {
  local step=$1 q=$2; shift 2
  selected "$step" || return 1
  if ((AUTO)); then
    credentials "$@" || { echo "Skipped $step: one or more required credentials are empty (see .env.setup.example)."; return 1; }
    return 0
  fi
  ask "$q"
}
hidden() { local v; read -rsp "$1: " v; echo >&2; [[ -n $v ]] || fail "A value is required."; printf '%s' "$v"; }
path() { local p; read -rp "$1: " p; p=${p%"${p##*[![:space:]]}"}; p=${p#[\'\"]}; p=${p%[\'\"]}; p=${p//\\/}; printf '%s' "${p/#\~/$HOME}"; }

bold "Hosted setup target: $REF → $SITE_URL"
if ((CHECK)); then
  echo "Validation only; no remote changes."
  for step in "${selected_steps[@]}"; do
    case $step in
      auth) vars=(SUPABASE_ACCESS_TOKEN) ;;
      email) vars=(SUPABASE_ACCESS_TOKEN RESEND_API_KEY SENDER_EMAIL) ;;
      stripe) vars=(SUPABASE_ACCESS_TOKEN STRIPE_SECRET_KEY) ;;
      push) vars=(SUPABASE_ACCESS_TOKEN APNS_KEY_FILE APPLE_TEAM_ID) ;;
    esac
    if credentials "${vars[@]}"; then echo "$step: credentials present"; else echo "$step: credentials missing; interactive setup will ask for them"; fi
  done
  exit 0
fi
((AUTO)) || [[ -t 0 ]] || fail "Interactive setup needs a terminal. For unattended setup, use --env-file FILE --yes; use --check to preview."
command -v curl >/dev/null || fail "Install curl first."
command -v supabase >/dev/null || fail "Install the Supabase CLI first. See README.md."

ensure_token() {
  if [[ -z ${SUPABASE_ACCESS_TOKEN:-} ]]; then
    echo "Create a token in the account that owns $REF: https://supabase.com/dashboard/account/tokens"
    SUPABASE_ACCESS_TOKEN=$(hidden "Supabase access token (sbp_...)")
  fi
  export SUPABASE_ACCESS_TOKEN
}
AUTH_API="https://api.supabase.com/v1/projects/$REF/config/auth"
auth_patch() {
  # Credentials and request bodies are passed through private files, not command-line arguments.
  node -e "process.stdout.write(JSON.stringify($1))" > "$TMP_SETUP/auth.json"
  curl -sS --fail --config "$TMP_SETUP/curl" -X PATCH "$AUTH_API" --data-binary "@$TMP_SETUP/auth.json" > /dev/null || fail "Supabase auth update failed. Check the project ref and token permissions."
}
prepare_auth() {
  ensure_token
  node -e 'const t = process.env.SUPABASE_ACCESS_TOKEN; if (/[\r\n]/.test(t)) process.exit(1); process.stdout.write(`header = "Authorization: Bearer ${t.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")}\"\nheader = "Content-Type: application/json"\n`)' > "$TMP_SETUP/curl"
}
set_secrets() {
  node -e 'const fs = require("node:fs"); for (const name of process.argv.slice(1)) { const value = process.env[name]; if (!value) { console.error(`Missing ${name}`); process.exit(1); } fs.appendFileSync(process.env.SETUP_SECRETS_FILE, `${name}=${JSON.stringify(value)}\n`); }' "$@"
  supabase secrets set --project-ref "$REF" --env-file "$SETUP_SECRETS_FILE" > /dev/null
  rm -f "$SETUP_SECRETS_FILE"
}
export SETUP_SECRETS_FILE="$TMP_SETUP/secrets.env"

if go auth "Configure sign-in URLs and 6-digit codes for $SITE_URL?" SUPABASE_ACCESS_TOKEN; then
  prepare_auth
  auth_patch '{ site_url: process.env.SITE_URL, uri_allow_list: process.env.SITE_URL + "/**,http://localhost:3000/**", mailer_otp_length: 6, mailer_otp_exp: 900 }'
  set_secrets SITE_URL
  echo "Sign-in URLs, code expiry and the automation site URL saved. Configure email next so customers receive codes."
fi

if go email "Configure Resend SMTP and code emails? (requires a verified sender domain)" SUPABASE_ACCESS_TOKEN RESEND_API_KEY SENDER_EMAIL; then
  prepare_auth
  export SENDER=${SENDER_EMAIL:-$(read -rp "Send from (e.g. hello@yourdomain.com): " v; printf '%s' "$v")}
  export SMTP_PASS=${RESEND_API_KEY:-$(hidden "Resend API key (re_...)")}
  [[ -n $SENDER && -n $SMTP_PASS ]] || fail "Sender email and Resend key are required."
  auth_patch '{ smtp_admin_email: process.env.SENDER, smtp_host: "smtp.resend.com", smtp_port: "465", smtp_user: "resend", smtp_pass: process.env.SMTP_PASS, smtp_sender_name: "Salebell" }'
  unset SMTP_PASS
  auth_patch '(() => { const html = require("fs").readFileSync("supabase/templates/otp.html", "utf8"); const subject = "Your Salebell sign-in code"; return { mailer_subjects_magic_link: subject, mailer_templates_magic_link_content: html, mailer_subjects_confirmation: subject, mailer_templates_confirmation_content: html }; })()'
  echo "Email sender and both sign-in code templates saved."
fi

if go stripe "Configure Stripe products, prices, FOUNDER code and webhook?" SUPABASE_ACCESS_TOKEN STRIPE_SECRET_KEY; then
  ensure_token
  export STRIPE_SECRET_KEY=${STRIPE_SECRET_KEY:-$(hidden "Stripe secret key (sk_test_... or sk_live_...)")}
  export STRIPE_WEBHOOK_URL="https://$REF.supabase.co/functions/v1/stripe-webhook"
  node scripts/stripe-setup.mjs > "$TMP_SETUP/stripe"
  sed '/^Set these as/,$d' "$TMP_SETUP/stripe"
  while IFS='=' read -r name value; do
    case $name in STRIPE_PRICE_MONTHLY|STRIPE_PRICE_YEARLY|STRIPE_WEBHOOK_SECRET) export "$name=$value" ;; esac
  done < "$TMP_SETUP/stripe"
  if [[ -z ${STRIPE_WEBHOOK_SECRET:-} ]]; then
    if ((AUTO)); then fail "Existing Stripe webhook: set STRIPE_WEBHOOK_SECRET in the env file and rerun --steps stripe. Reveal it in the Stripe dashboard."; fi
    STRIPE_WEBHOOK_SECRET=$(hidden "Existing Stripe webhook signing secret (whsec_...)")
    export STRIPE_WEBHOOK_SECRET
  fi
  set_secrets STRIPE_SECRET_KEY STRIPE_PRICE_MONTHLY STRIPE_PRICE_YEARLY STRIPE_WEBHOOK_SECRET SITE_URL
  echo "Stripe secrets saved. Finish in Stripe: Settings → Billing → Customer portal → Save."
fi

if go push "Configure iPhone push with your APNs key?" SUPABASE_ACCESS_TOKEN APNS_KEY_FILE APPLE_TEAM_ID; then
  ensure_token
  p8=${APNS_KEY_FILE:-$(path "Drag AuthKey_XXXXXXXXXX.p8 here")}; p8=${p8/#\~/$HOME}
  [[ -r $p8 ]] || fail "APNs key file is not readable: $p8"
  export APNS_KEY_ID=${APNS_KEY_ID:-$(basename "$p8" .p8)}; APNS_KEY_ID=${APNS_KEY_ID#AuthKey_}
  export APNS_TEAM_ID=${APPLE_TEAM_ID:-$(read -rp "Apple Team ID (10 characters): " v; printf '%s' "$v")}
  [[ $APNS_KEY_ID =~ ^[A-Z0-9]{10}$ && $APNS_TEAM_ID =~ ^[A-Z0-9]{10}$ ]] || fail "APNs key ID and Apple Team ID must each be 10 uppercase letters or digits."
  export APNS_KEY_P8=$(cat "$p8") APNS_TOPIC=$BUNDLE_ID
  set_secrets APNS_KEY_P8 APNS_KEY_ID APNS_TEAM_ID APNS_TOPIC
  echo "Push secrets saved. Set DEVELOPMENT_TEAM = $APNS_TEAM_ID in ios/Config/Base.xcconfig for device builds."
fi

bold "Selected steps finished. Verify customer sign-in, checkout and push using docs/SETUP.md."
