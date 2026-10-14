# Reporting security issues

Please report suspected vulnerabilities through [GitHub private vulnerability reporting](https://github.com/salebell/salebell/security/advisories/new) when available. If private reporting is unavailable, contact the repository owner privately through their GitHub profile before sharing reproduction details publicly. Never attach live private keys, customer purchase tokens or database exports to a public issue.

Include the affected revision, deployment mode, reproduction steps and expected impact using synthetic data. The repository's maintainers handle software reports; the operator of each self-hosted installation is responsible for its configuration, updates, backups and access controls.

Public browser configuration contains a Supabase anon/publishable key by design. Service-role credentials, JWT signing secrets, APNs keys and customer Apple private keys must remain private. Customer keys saved by the application are encrypted using Supabase Vault.
