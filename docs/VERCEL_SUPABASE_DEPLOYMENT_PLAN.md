# Browser Deployment Implementation Plan

> For agentic workers: use superpowers:executing-plans for native execution, task by task. The user authorized implementation and pushing to main on 2026-10-15.

**Goal:** Implement the reviewed browser-only Vercel/Supabase deployment flow and push verified code to main, keeping public launch gated on operator registration and live qualification.

**Architecture:** Vercel clones the repository and provisions native Supabase resources. An opt-in canonical installer handles provider OAuth, verifies project bindings and advances a persisted provisioning job. Installed instances do not depend on the installer at runtime.

**Tech Stack:** Existing Next.js/TypeScript, Node crypto, Supabase Management API, Vercel REST API and private PostgreSQL control storage exposed only through service-role RPCs.

**Spec:** [VERCEL_SUPABASE_DEPLOYMENT_DESIGN.md](VERCEL_SUPABASE_DEPLOYMENT_DESIGN.md)

## Global constraints

- No terminal, SQL, API-key copying or custom domains for installing users.
- Fresh/empty projects and interrupted installs only; no existing-instance upgrades.
- Fixed OAuth callbacks; encrypted credentials expire after 24 hours; nonsecret records expire after seven days.
- Production origins and projects come from authenticated provider metadata.
- Never reset an existing owner password or provision during ordinary app builds.
- Public launch requires operator registration and a real complete installation.
- Work directly on main and push as explicitly requested; use native execution.

## Review focus

- Replayed OAuth and mismatched project identifiers must not grant installation rights.
- Two tabs or a timed-out provider response must not repeat migrations or owner creation.
- Native Supabase secret/public keys and new JWT signing keys must retain server authentication.
- Initial Vercel builds must work before application migrations exist.
- Unconfigured installer hosts must expose no active provisioning API or misleading deploy button.

## Task 1: Deployment configuration, release assets and authorization primitives

Files: `web/lib/installer-config.ts`, `web/lib/installer-security.ts`, `web/lib/installer-types.ts`, corresponding `web/lib/*.test.ts`, `web/scripts/build-installer-assets.mjs`, generated `web/installer/release.json`, `web/next.config.ts`.

Interfaces: `installerConfig(env)` validates opt-in operator settings; `siteOrigin(env)` resolves explicit or trusted Vercel production origin; `seal/open` bind encrypted records to their session; `deployUrl(config, state)` produces a pinned full-repository Vercel clone URL; release assets expose SQL checksums, function files and JWT settings.

- [ ] Write and run failing tests for disabled/misconfigured hosts, invalid origins, state expiry, cross-session ciphertext and pinned deploy links.
- [ ] Implement the primitives without dependencies or secret logging; generate assets from actual sources.
- [ ] Run focused tests and compare generated assets against repository inputs.

## Task 2: Persisted sessions, leases and provider clients

Files: `deploy/installer/control.sql`, `web/lib/installer-store.ts`, `web/lib/installer-providers.ts`, corresponding tests and SQL coverage.

Interfaces: service-role RPC store supports create/read/CAS/lease/bind/cleanup/rate-limit; provider clients exchange OAuth, validate configuration/project metadata, apply SQL, deploy function assets, update Auth/secrets/environment and read deployments. Errors are classified without including provider bodies.

- [ ] Write failing tests for unauthorized sessions, stale CAS, duplicate bindings, OAuth state replay, provider 401/429 and cross-project validation.
- [ ] Implement private storage and bounded API clients; use documented request schemas.
- [ ] Run focused tests and exercise storage permissions/concurrency in disposable PostgreSQL.

## Task 3: Provisioning and owner state machine

Files: `web/lib/installer-runner.ts`, `web/lib/installer-sql.ts`, `web/lib/installer-owner.ts` and focused tests.

Interfaces: `advance(job, dependencies)` performs one bounded step, reconciles its effects and returns updated state; `createOwner` accepts credentials only in memory and verifies identity/workspace without password resets. Migration SQL holds a transaction lock and records checksums atomically.

- [ ] Write failing tests for foreign schemas, lost migration responses, duplicate advances, partial function deployment, existing owners and temporary-session logout.
- [ ] Implement resource checks, migrations, self-hosted settings, functions, Auth/secrets, final production deploy and readiness checks.
- [ ] Run focused tests plus existing backend tests; preserve JWT verification or report incompatible target settings.

## Task 4: Browser flow and server routes

Files: `web/app/deploy/*`, `web/app/api/deploy/[action]/route.ts`, `web/lib/installer-http.ts`, `web/app/api/instance-health/route.ts`, `web/app/install/page.tsx`, initial login state and tests.

Interfaces: same-origin POST actions start/connect/select/advance/owner/cancel; no-store GET status/callback/cleanup; signed HttpOnly session cookie authorizes every job access. UI polls sequentially and shows provider names, current step and actionable errors without technical configuration fields.

- [ ] Write failing HTTP tests for disabled hosts, CSRF, missing cookies, malformed requests, replayed callbacks and sanitized status.
- [ ] Implement thin Next routes around tested handlers and the browser setup UI.
- [ ] Run web tests, lint and production build; verify setup-pending pages render without database tables.

## Task 5: Operator setup, documentation, review and push

Files: `docs/VERCEL_SUPABASE_DEPLOYMENT.md`, README, self-hosting/setup docs, web self-host page, environment example and installer cleanup configuration.

- [ ] Document provider registration, scopes, control-schema setup, release pinning, expiry cleanup and real-install qualification.
- [ ] Keep the public entry point gated; document browser installation availability accurately.
- [ ] Run root/web tests, SQL tests, lint, build and whitespace checks; independently review the whole change and fix material findings.
- [ ] Commit only task files, fetch origin, reconcile main without overwriting unrelated work, and push main as authorized.
- [ ] Report verified results and any operator registration/live-test requirements explicitly.
