# Self-host Salebell

This guide installs everything on your own server with Docker Compose. For **Vercel + hosted Supabase**, use the [separate deployment guide](VERCEL_SUPABASE_DEPLOYMENT.md); that setup uses provider-supplied addresses and does not need the two DNS records below.

Run Salebell on your own server with the web dashboard, database and notification receivers included. Apps, integrations, full event history, forwarding and CSV export are available without a Salebell subscription or Stripe configuration.

You do **not** need a Supabase account, Vercel account, email provider or iPhone build to get started. The installer runs the required services with Docker Compose.

## 1. Prepare your server and DNS

You need:

- A server with persistent storage, Git, **Node.js 22.6 or later**, and **Docker Engine with Docker Compose v2**.
- Two domain names pointing to that server's public IP address.
- Ports **80 and 443** available and reachable from the internet. Caddy sets up HTTPS automatically.

Use two different hostnames. For example:

| Hostname | Purpose |
|---|---|
| `salebell.example.com` | Dashboard and Apple notification URLs |
| `api.salebell.example.com` | API used by the dashboard and companion app |

Create a DNS `A` record for each hostname pointing to the server's IPv4 address. If you also use `AAAA` records, they must point to working IPv6 on the same server. Replace the example hostnames below with yours.

On the server, confirm the tools are available:

```sh
node --version
docker compose version
docker info
```

You do not need to expose database or administration ports. The production installer manages its own Supabase services; `npm run dev` is for local development.

## 2. Install

Run these commands **on your server**:

```sh
git clone https://github.com/salebell/salebell.git salebell
cd salebell

npm run self-host -- init \
  --site-url https://salebell.example.com \
  --api-url https://api.salebell.example.com \
  --email owner@example.com

npm run self-host -- up
```

Use your email address for `--email`. It becomes the first owner's login; no email is sent during setup. URLs must be complete HTTPS origins, with no path or custom port.

`init` creates the configuration and a random owner password. `up` builds the dashboard, starts the services, applies database migrations, creates the owner and runs installation checks. The first build can take several minutes. Wait for **Salebell is ready at ...** before signing in.

You do not need to run `npm install` or install the Supabase CLI. Docker installs the web dependencies during the build.

## 3. Sign in

Read the generated password in your server terminal:

```sh
cat deploy/owner-password
```

Open `https://salebell.example.com/login` in your browser. Sign in with the email from step 2 and that password.

The dashboard should show **Self-hosted**, with an **Instance** tab instead of Billing. All features are included. Public registration is closed by default.

Keep these files private:

| File | Purpose |
|---|---|
| `deploy/.env` | Configuration, service credentials and optional provider settings |
| `deploy/owner-password` | Generated login password, also used by installation checks |

For configuration changes, edit the existing `.env` and run `npm run self-host -- up` again. Do not rerun `init` or regenerate the keys for an existing database. Do not `source` the `.env` file; the installer reads it for you.

## 4. Connect your first app

1. Click **Add app** in the dashboard.
2. Import your app with an App Store Connect API key, or choose **Enter app details manually** and provide its name and bundle ID.
3. Follow the dashboard's steps to connect **Version 2** Apple server notifications. If you already use another receiver, preserve its URLs through forwarding before replacing them.
4. Make a sandbox purchase and confirm the event appears in Salebell. If you use the optional Apple test, confirm the notification arrives; an accepted test request alone does not prove delivery.
5. Add an alert destination, such as Slack, Discord or Telegram, and use **Send test alert**. You can skip alerts and use the dashboard alone.

[Detailed app connection steps](SETUP.md#connect-your-first-app-as-a-customer).

Apple in-app purchases and subscriptions are supported. Google Play RTDN is available in preview; its [setup and limitations](GOOGLE_PLAY_RTDN.md) are separate from installing Salebell.

## 5. Save a backup

From the `salebell` directory on your server:

```sh
npm run self-host -- backup
```

Copy the **whole backup directory** printed by the command to private storage outside this server. It includes the database, credentials and encryption material needed to restore saved keys. Take regular backups as you use the instance.

[Backup, update and recovery instructions](SELF_HOSTING_OPERATIONS.md).

## Optional setup

You can add these later. Edit `deploy/.env`, then run `npm run self-host -- up`.

| Want to… | Instructions |
|---|---|
| Sign in using email codes | [Configure SMTP](SELF_HOSTING_OPERATIONS.md#optional-email-iphone-alerts-and-operator-details) |
| Receive iPhone push alerts | [Build the companion for your instance](../ios/README.md#self-hosted-companion) and configure your own APNs credentials |
| Set your operator name and support email | [Configure operator details](SELF_HOSTING_OPERATIONS.md#optional-email-iphone-alerts-and-operator-details) |

The Salebell Cloud iPhone app connects to the cloud service. Self-hosted iPhone alerts require your own compatible build. Chat and webhook alerts work without an iPhone app.

## If something goes wrong

Run:

```sh
npm run self-host -- status
npm run self-host -- check
```

| Problem | What to check |
|---|---|
| Docker cannot connect | Start Docker and confirm `docker info` works |
| Website will not open | Both DNS records point to your server; ports 80/443 are open and available |
| Password does not work | Use your `--email` address and the contents of `deploy/owner-password`, not an email code |
| Dashboard cannot reach the API | Open the API hostname and check HTTPS; both hostnames must work |
| No Apple events | Check the receiver URLs and Version 2 in App Store Connect, then make a sandbox purchase |

Installation checks verify internal services. Also open the public site and confirm a real notification and any configured alerts arrive.

For logs, configuration, updates and recovery, see the [operations guide](SELF_HOSTING_OPERATIONS.md). Component versions and attribution are in [UPSTREAM.md](../deploy/UPSTREAM.md).
