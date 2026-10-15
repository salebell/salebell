# Contributing to Salebell

Salebell is MIT-licensed software for receiving verified app purchase events and sending useful alerts. iOS/App Store notifications are implemented. Google Play RTDN has preview Android onboarding and authenticated Pub/Sub delivery. See [implementation and remaining work](docs/GOOGLE_PLAY_RTDN.md).

Start with [local development](README.md#develop-locally), then read [the product contract](docs/PRODUCT.md). For production self-hosting, use [the operator guide](docs/SELF_HOSTING.md).

Keep changes focused. Include reproduction steps for a bug or the customer workflow a feature improves. Add behavioral tests for changes to authentication, notification verification, billing, plan enforcement, delivery and revenue calculations. Documentation and visual copy changes can be verified directly.

Run the relevant checks before opening a pull request:

```sh
npm test
npm run test:sql
npm --prefix web test
npm --prefix web run lint
npm --prefix web run build
```

SQL checks use a throwaway local PostgreSQL database. Web builds need explicit configuration from `web/.env.local.example` or `web/.env.example`; never use a production service-role key in browser configuration. The iPhone companion has its own build instructions in [ios/README.md](ios/README.md).

Do not submit private Apple keys, service-role keys, customer payloads, generated deployment credentials or database backups. Existing synthetic fixtures are test-only. Describe suspected security vulnerabilities privately using [SECURITY.md](SECURITY.md).

Self-hosting support is community support. A contribution should work without a Salebell Cloud account or paid provider unless that provider is the integration being added. Changes must preserve cloud and self-hosted mode boundaries, tenant isolation and existing subscription records.
