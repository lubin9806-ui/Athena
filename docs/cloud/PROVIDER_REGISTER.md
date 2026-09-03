# Athena Cloud provider and data-terms register

Machine-readable source: `cloud/config/provider-policies.json`.

## Current adapters

| Domain | Adapter | Data/cost | Production status |
|---|---|---|---|
| Model | `local-fixture` | Current prompt exists in process memory for one call; no voice; no network; no retention/training; deterministic local response | Not eligible |
| Search | `local-fixture` | Current query exists in process memory for one call; no HTML scraping; example.test citations marked untrusted | Not eligible |
| Billing | `local-no-charge` | Entitlement state only; creates no charge, invoice, tax record or refund transfer | Not eligible |
| Deployment | `local` | Local files and simulated `local-1`/`local-2`; no cloud resource | Not eligible |
| Recovery | `local-return-token` | Returns one-time token to local caller; no email/SMS | Not eligible |
| Secrets | environment variable | Master key in process environment; not written to DB | Not eligible for production custody |

No real fee, cloud resource, model request, email or SMS is produced by Window 09.

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
