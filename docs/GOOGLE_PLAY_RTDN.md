# Google Play RTDN — coming soon

**Status: planned, not implemented.** Google Play appears as coming soon in app setup and public pages. It does not create an app, consume a plan slot, request credentials or provide a working receiver URL. The current receiver supports Apple's App Store Server Notifications V2 only.

## Planned connection

```text
Google Play Console → Cloud Pub/Sub topic (RTDN)
                    → authenticated push subscription
                    → Salebell Google receiver
                    → Google Play Developer API purchase lookup
                    → normalized events, dashboard and alerts
```

RTDN tells the receiver that purchase state changed, rather than supplying complete purchase information. Google requires a Play Developer API request after receipt to obtain full state. [RTDN setup](https://developer.android.com/google/play/billing/getting-ready#configure-rtdn), [notification reference](https://developer.android.com/google/play/billing/rtdn-reference).

## Requirements before enabling Android setup

- Associate connected apps with their store and Android package name; keep Apple's bundle/app IDs separate.
- Configure Pub/Sub, Google Play publishing access and purchase API credentials. Store credentials encrypted per workspace; none are collected in this release.
- Verify Pub/Sub push signatures, issuer, expected audience and service-account identity. A package name or unguessable URL alone is insufficient. [Authenticated push subscriptions](https://cloud.google.com/pubsub/docs/authenticate-push-subscriptions).
- Decode the Pub/Sub envelope and RTDN payload; handle subscription, one-time purchase, voided-purchase and test notifications according to Google's reference.
- Deduplicate redeliveries and reconcile out-of-order state using authoritative API lookups. Acknowledge after durable processing or queueing; transient failures must be retryable.
- Do not count each RTDN as new revenue. Record monetary changes only when a unique verified transaction and trustworthy price/currency are established. Missing prices remain visibly unknown.
- Keep tests separate from purchases and show verified delivery status. Design forwarding/fan-out explicitly: Pub/Sub setup differs from Apple's notification URLs.
- Apply the same self-hosted/cloud entitlements, tenant isolation and export rules as Apple events.

This roadmap adds server-side monitoring for apps already using Google Play Billing. It does not replace the Play Billing Library or announce an Android companion app. No release date is committed.
