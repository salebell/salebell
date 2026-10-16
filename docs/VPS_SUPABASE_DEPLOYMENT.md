# Host the website on a VPS with your own Supabase

Run the website directly with Node.js on your server and use your own Supabase project for the database, Auth, Realtime, Vault and Edge Functions. You need one public website hostname; Supabase provides the API hostname. **Docker is not required.**

For Vercel, use [the guided installer](VERCEL_SUPABASE_DEPLOYMENT.md). This VPS path is manual; `npm run deploy` currently targets Vercel. The web host needs Node.js or Docker, not static-only hosting. See [Next.js self-hosting](https://nextjs.org/docs/app/guides/self-hosting).

## 1. Prepare Supabase

Follow [manual backend installation](VERCEL_SUPABASE_DEPLOYMENT.md#1-create-and-deploy-your-backend) in a fresh Supabase project: apply migrations, deploy functions, select `self_hosted` mode and set Vault's `project_url`. For [sign-in configuration](VERCEL_SUPABASE_DEPLOYMENT.md#3-configure-sign-in) and the `SITE_URL` backend secret, use your VPS origin, for example `https://salebell.example.com`, instead of a Vercel address.

Create a confirmed owner with an email/password and disable public signup. Password sign-in works without SMTP; email codes and recovery require SMTP.

## 2. Build and run the website

Install Git, Node.js 22.6+ with npm, and an HTTPS reverse proxy such as Caddy or Nginx on your VPS. Substitute your real project URL, public key and website origin:

```sh
git clone https://github.com/salebell/salebell.git salebell
cd salebell
cat > web/.env.local <<'EOF'
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLIC_KEY
NEXT_PUBLIC_SITE_URL=https://salebell.example.com
NEXT_PUBLIC_DEPLOYMENT_MODE=self_hosted
EOF
npm ci --prefix web
npm run build --prefix web
npm run start --prefix web -- --hostname 127.0.0.1 --port 3000
```

The last command runs in the foreground for an initial check. For production, configure systemd or your existing process manager to run that command from the repository directory as a non-root user, restart on failure and start on boot. Use the absolute path to npm and make sure the service can find the same Node.js installation used for the build. Keep `web/.env.local` available to the service.

These public values are compiled into the build; rebuild and restart after changing them. Never put service-role or management keys in `NEXT_PUBLIC_*` variables. Leave `SUPABASE_INTERNAL_URL` unset: webhooks forward to the public Supabase URL. Full-stack Compose explicitly supplies its private gateway separately.

## 3. Serve HTTPS

Point the website hostname at the VPS and put an HTTPS reverse proxy in front of port 3000. For Caddy running on the host:

```caddyfile
salebell.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

Open ports 80/443, configure Caddy as a system service and reload its configuration. Keep the website publicly reachable for Apple notifications.

## 4. Verify and connect an app

```sh
curl --fail https://salebell.example.com/login
curl --fail https://salebell.example.com/api/instance-health
curl -i -X POST \
  https://salebell.example.com/hooks/apple/notarealkey1/production \
  -H 'content-type: application/json' -d '{}'
```

Health should report `self_hosted`; the unknown key should return the backend's 404 JSON, proving proxy reachability. Sign in, connect an app and verify a real sandbox notification. Check backups/restores in Supabase; store optional provider credentials in its Edge Function secrets.

## Optional alternative: Docker

If you prefer a container, install Docker Engine and use the existing Dockerfile instead of the Node.js build/start commands above. From the repository root:

```sh
docker build -t salebell-web ./web \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co \
  --build-arg NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLIC_KEY \
  --build-arg NEXT_PUBLIC_SITE_URL=https://salebell.example.com \
  --build-arg NEXT_PUBLIC_DEPLOYMENT_MODE=self_hosted
docker run -d --name salebell-web --restart unless-stopped \
  -p 127.0.0.1:3000:3000 salebell-web
```

Only public configuration belongs in these build arguments. The host reverse proxy configuration stays the same. If the proxy also runs in Docker, use a shared Docker network and forward to `salebell-web:3000`; the proxy container's loopback address is not the host's.

## Connect the iPhone app

The shared-app implementation is in this repository. When a compatible App Store/TestFlight distribution is supplied, install it and open **Settings → Server**. Enter this website's HTTPS URL, the public Supabase API URL and public/publishable key, then sign in to your own instance. You do not need another managed login, an Apple developer membership, APNs secrets or your own app publication.

Push depends on the managed Salebell relay. Publication and live relay qualification remain operator tasks; see [connection and operator setup](PUSH_RELAY.md) and the [implementation review](DEPLOYMENT_REVIEW.md). Customer instances use normal migrations and backend functions only; never apply the operator relay schema or copy Salebell's private APNs key. A privately built direct-APNs app remains an advanced alternative. Chat/webhook alerts and dashboard access work independently of the relay.
