# Render staging deployment

This deployment shape exists to test Athena account and sync flows over a real HTTPS endpoint. It is a single-instance staging environment for synthetic or disposable private-beta data. It is not the Athena Cloud production architecture and does not change the decision in [CLOUD_GO_NO_GO.md](./CLOUD_GO_NO_GO.md).

## Why this shape

- Region: Render Singapore.
- Runtime: the reviewed `cloud/Dockerfile`, running as the unprivileged `node` user.
- Compute: one `0.5c-512mb` paid web-service instance.
- State: one 1 GB persistent disk mounted at `/app/storage` for SQLite, encrypted backups, and data exports.
- TLS: terminated by Render; Athena still sends HSTS and the existing API security headers.
- Deploys: manual. `autoDeployTrigger: off` prevents a repository push from automatically replacing the staging service.
- Secret: Render generates `ATHENA_CLOUD_MASTER_KEY_BASE64` once. Never rotate or delete it without an explicit data migration or intentional staging reset.

The disk makes this service single-instance and causes brief downtime during deploys. There is no horizontal scaling, cross-region failover, or zero-downtime rollout in this stage.

## Create the staging service

1. Push the reviewed commit to the repository that Render will read.
2. Create a Render account and a new Blueprint from the repository-root `render.yaml`.
3. Before accepting, verify the service is named `athena-cloud-staging`, is in `singapore`, uses `0.5c-512mb`, and attaches a 1 GB disk. This creates billable resources.
4. Keep the generated `ATHENA_CLOUD_MASTER_KEY_BASE64`. Do not paste a secret into the repository.
5. Trigger the first deploy manually.
6. Open `https://<service>.onrender.com/health/ready`. It must report `status=ready`, deployment region `singapore`, and runtime binding `cloudProvider=render`.
7. Run `npm.cmd --prefix cloud run verify:staging` locally. This verifies the deployment contract without creating cloud resources.
8. Run `npm.cmd run test:cloud-staging:live` locally. This creates a disposable synthetic account, exercises the real HTTPS account/sync path, verifies revocation and first-login merge behavior, and cryptographically deletes the account before exit.

Use only test accounts at this point. Recovery delivery remains `local-return-token` but staging suppresses that token from HTTP responses, so password recovery is intentionally unavailable. Billing is no-charge and model/search responses are fixtures.

## Add the domain after the first health check

The staging hostname is `staging-api.elanastra.com` and is declared in `render.yaml`. The domain currently uses Cloudflare nameservers, so after the first Render deploy create a Cloudflare CNAME named `staging-api` pointing to the exact `<service>.onrender.com` hostname shown by Render. Start with Cloudflare proxying set to **DNS only**, remove any conflicting `AAAA` record for this hostname, then ask Render to verify the domain and issue TLS. Keep the default `onrender.com` hostname until custom-domain TLS and the packaged desktop and Android probes both pass.

Do not use the eventual production hostname (`api.<your-domain>`) for this service. Production also requires managed recovery delivery, production provider decisions, independent security review, operational ownership, and a state architecture that is not tied to one SQLite disk.

## Evidence and rollback

Capture the Blueprint service ID, deploy ID, health response, hostname, region, plan, disk size, and current commit. A failed deploy can be rolled back at the service level, but persistent state must be treated separately. Staging data may be intentionally reset; never infer that a Render disk snapshot is an application-consistent SQLite backup.

## Active staging evidence (2026-09-26)

- Blueprint: `exs-dars0bvpn0mc73dqcgj0`.
- Service: `srv-darsasvavr4c73808ghg` (`athena-cloud-staging`).
- Deploy: `dep-darshbnavr4c73811sl0`, commit `31527d3`.
- Runtime: Render Singapore, `0.5c-512mb`, one instance, 1 GB persistent disk.
- Provider hostname: `https://athena-cloud-staging.onrender.com`.
- Custom hostname: `https://staging-api.elanastra.com`, Cloudflare DNS-only CNAME with Render-managed TLS.
- Readiness: HTTP 200 with `status=ready`, SQLite available, region `singapore`, deployment adapter `render`, no-charge billing, local-return-token recovery, and fixture model/search providers.
- Live acceptance: disposable registration, HTTPS session binding, device revoke, recovery-token suppression, first-login merge gate, explicit preference conflict, Android-origin JPEG background, adult-mode state, logout-local-data preservation, desktop-tool exclusion, and account cryptographic erase all passed. The unsigned `0.9.7-beta.1` engineering package also passed ready-to-show/DOM smoke and the same live flow from `app.asar`, using only its packaged `resources/account-config.json`; its isolated profile and disposable account were removed. Machine-readable evidence: [athena-cloud-render-staging-live.json](../quality/athena-cloud-render-staging-live.json).

This evidence proves only the named staging deployment and disposable-data integration path, including an unsigned packaged-desktop engineering run. It does not prove a signed clean-checkout desktop distribution, Android behavior, high availability, production recovery delivery, production billing/model/search providers, or production readiness.
