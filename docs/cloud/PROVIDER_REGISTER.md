# Athena Cloud provider and data-terms register

Machine-readable source: `cloud/config/provider-policies.json`.

## Current adapters

| Domain | Adapter | Data/cost | Production status |
|---|---|---|---|
| Model | `local-fixture` | Current prompt exists in process memory for one call; no voice; no network; no retention/training; deterministic local response | Not eligible |
| Search | `local-fixture` | Current query exists in process memory for one call; no HTML scraping; example.test citations marked untrusted | Not eligible |
| Billing | `local-no-charge` | Entitlement state only; creates no charge, invoice, tax record or refund transfer | Not eligible |
| Deployment | `local` | Local files and simulated `local-1`/`local-2`; no cloud resource | Not eligible |
| Deployment | `render` | Single Render Singapore instance with one persistent SQLite disk; staging Blueprint only | Not eligible for production or HA claims |
| Recovery | `local-return-token` | Returns one-time token to local caller; no email/SMS | Not eligible |
| Secrets | environment variable | Master key in process environment; not written to DB | Not eligible for production custody |

No real fee, cloud resource, model request, email or SMS is produced by Window 09.

Every configured adapter name is a runtime binding, not descriptive metadata. Service startup rejects missing port methods or an adapter ID that differs from the reviewed configuration, and `/health/ready` reports the bound IDs for deployment verification.

## Required production model-provider record

Do not set `productionEligible=true` until all fields have named approvers and evidence:

- legal entity, service/product and contract version;
- terms URL, DPA URL, privacy URL and effective/review dates;
- exact request/response data sent, including prompt, attachments, voice and identifiers;
- processing/storage regions, subprocessors and cross-border transfer mechanism;
- prompt/voice/log retention, deletion SLA and backup deletion;
- training or human-review use and the enforceable opt-out/configuration;
- abuse monitoring, government/law-enforcement request process and breach notification;
- availability/rate limits, incident contact, export/delete API and termination handling;
- content-safety responsibilities and appeal/human-escalation handoff.

Athena policy for 1.0 is prompt retention `none` and voice retention `none` in Athena-owned storage. If a provider cannot contractually/configurably meet the approved upstream limit, it cannot be selected. Usage metering stores counts, provider ID, mode, outcome and duration only.

## Billing and region decision record

The product owner must decide price, currency, tax nexus, merchant of record, invoices, trials, delinquency, suspension, refunds, chargebacks and data retention before selecting a billing adapter. The adapter contract already supports trial, active, past-due, suspended, cancelled and refunded states, but the local transitions do not prove processor behavior.

The infrastructure owner must decide cloud vendor, primary/secondary regions, residency commitments, KMS, database, immutable backup account, egress allowlist and data-processing agreements. Region names in local tests are placeholders, not deployment claims.

## Current decision

Production model provider: **unselected**. Billing provider: **unselected**. Cloud provider and regions: **unselected**. Recovery delivery provider: **unselected**. Therefore Cloud production remains fail-closed and No-Go.

## Staging decision (2026-09-25)

Render Singapore is the selected first staging target because it can run the existing Node.js service and attach a persistent disk with minimal product-code change. The repository contains a manual-deploy Blueprint for `staging-api.elanastra.com`, but no Render account, billable resource, DNS record, or live deployment has been created or verified yet. This decision is limited to disposable account/sync integration data and does not select the production cloud provider, database, secondary region, KMS, or backup architecture.
