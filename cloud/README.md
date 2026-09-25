# Athena Cloud 1.0 engineering boundary

This directory is an independent Node.js service. It does not import Electron, Desktop SQLite, renderer code, computer tools, Steamworks, or Mobile UI. The local runtime is a security and protocol test environment; it is not a production Cloud release.

## Local start

```powershell
cd G:\Athena\cloud
npm.cmd install
Copy-Item .env.example .env
# Set a fresh 32-byte ATHENA_CLOUD_MASTER_KEY_BASE64 in the current environment.
npm.cmd start
```

The server listens on `127.0.0.1:8787` by default. Local HTTP is intentionally loopback-only. Production mode refuses to start unless TLS termination, a non-test master key, deployment region, cloud provider, billing adapter, account-recovery delivery adapter, model provider, and search provider decisions are supplied.

Configuration names are binding: startup rejects a model, search, billing, deployment, or recovery adapter whose runtime `id` does not exactly match the reviewed configuration. Naming a production vendor can therefore never silently fall back to a local fixture. `/health/ready` reports the bound adapter IDs so deployment evidence can verify what is actually running.

## Verification

```powershell
npm.cmd test
npm.cmd run drill
npm.cmd run verify
npm.cmd audit --audit-level=high
```

Expected final markers:

- `ATHENA_CLOUD_DRILL_OK`
- `ATHENA_CLOUD_1_0_ENGINEERING_OK`

The marker says the local engineering boundary passed. It does not override [CLOUD_GO_NO_GO.md](../docs/cloud/CLOUD_GO_NO_GO.md), which remains the release authority.

## Managed staging

The repository includes a manual-deploy Render Blueprint and container for a single-instance Singapore staging service. It is intended only for synthetic account/sync testing over a real HTTPS endpoint. Validate the contract with `npm.cmd run verify:staging`, then follow [RENDER_STAGING.md](../docs/cloud/RENDER_STAGING.md). The attached SQLite disk cannot scale horizontally and does not make the service production-ready.

## Data and cost behavior

- Local state is written only under ignored `cloud/data`, `cloud/backups`, and `cloud/exports` paths.
- PII, sync payloads, MFA seeds, appeals, exports, and backups are encrypted with AES-256-GCM. Access, refresh, recovery, and idempotency secrets are not stored in plaintext.
- Idempotency replay entries hold the response a client was given (a decrypted record, a model answer), so they are sealed with the tenant key as well and expire after 24 hours. Entries written by earlier builds in plaintext are deleted at startup. The database runs with `secure_delete` so purged rows do not stay readable in free pages.
- Model prompts and voice are not retained. Usage records contain token counts and outcome metadata only.
- The default billing adapter cannot create a charge, invoice, tax event, or refund. The default model provider is a local fixture. No real cloud resource is created.
- Account deletion purges known backup files and writes an authenticated deletion ledger so an older staged restore cannot resurrect a deleted tenant.

See [ARCHITECTURE.md](../docs/cloud/ARCHITECTURE.md) and [API_V1.md](../docs/cloud/API_V1.md) for the boundary and protocol.
