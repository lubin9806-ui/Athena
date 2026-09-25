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
7. Run `npm.cmd run verify:staging` locally. This verifies the deployment contract without creating cloud resources.

Use only test accounts at this point. Recovery delivery remains `local-return-token` but staging suppresses that token from HTTP responses, so password recovery is intentionally unavailable. Billing is no-charge and model/search responses are fixtures.

## Add the domain after the first health check

Use a dedicated non-production hostname such as `staging-api.<your-domain>`. Add it to the service in Render, create the DNS record Render provides, and verify the domain. Keep the default `onrender.com` hostname until custom-domain TLS and the packaged desktop and Android probes both pass.

Do not use the eventual production hostname (`api.<your-domain>`) for this service. Production also requires managed recovery delivery, production provider decisions, independent security review, operational ownership, and a state architecture that is not tied to one SQLite disk.

## Evidence and rollback

Capture the Blueprint service ID, deploy ID, health response, hostname, region, plan, disk size, and current commit. A failed deploy can be rolled back at the service level, but persistent state must be treated separately. Staging data may be intentionally reset; never infer that a Render disk snapshot is an application-consistent SQLite backup.
