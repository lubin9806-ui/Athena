# Athena Cloud API v1

Base path: `/v1`. Media type: `application/json`. Errors use `application/problem+json` following [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457.html). Every response returns `Athena-API-Version: 1`, `X-Request-ID`, `Cache-Control: no-store`, HSTS and anti-sniffing headers.

Production transport is HTTPS only. The local fixture permits HTTP only on loopback. First-party clients send `Authorization: Bearer <access-token>`. Access and refresh tokens are opaque and rotated; they are not JWTs and are never stored in plaintext.

## Endpoints

| Method and path | Authentication | Purpose |
|---|---|---|
| `POST /v1/auth/register` | Public, rate limited | Create tenant owner and first device |
| `POST /v1/auth/login` | Public, rate limited | Password plus MFA/recovery code when enabled |
| `POST /v1/auth/refresh` | Refresh token | Rotate access and refresh tokens |
| `POST /v1/auth/recovery/request` | Public, enumeration-safe | Create a 15-minute recovery token |
| `POST /v1/auth/recovery/complete` | One-time token | Change password and revoke all sessions |
| `POST /v1/auth/logout` | Bearer | Revoke the current session and the device it belongs to (each login or pairing claim creates its own device, so signing out frees the slot) |
| `POST /v1/auth/mfa/setup` / `confirm` | Bearer | Enroll and prove TOTP; returns recovery codes once. `setup` returns 409 `mfa-already-enabled` while MFA is on |
| `POST /v1/auth/mfa/disable` | Bearer + current TOTP or recovery code | Turn MFA off; wrong codes count toward the login lockout |
| `GET /v1/account` | Bearer | Who this session is: tenant, user, email, role, `mfaEnabled`, current device |
| `GET /v1/devices` | Bearer | List own devices |
| `DELETE /v1/devices/{deviceId}` | Bearer | Revoke device and all its sessions |
| `GET /v1/sync/records/{resourceId}` | Bearer | Read one tenant/user-scoped record |
| `PUT /v1/sync/records/{resourceId}` | Bearer + idempotency key | Create, update or tombstone one record |
| `GET /v1/sync/changes?cursor=&limit=` | Bearer | Ordered incremental change feed |
| `POST /v1/model/responses` | Bearer + idempotency key | Create/Companion/Reason inference only; optional `history` of `{role,content}` |
| `POST /v1/search/query` | Bearer + idempotency key | First-party search proxy; local fixture only until a production-eligible provider is selected |
| `POST /v1/abuse/{caseId}/appeal` | Bearer | Submit encrypted appeal for manual review |
| `GET /v1/entitlements` | Bearer | Read quota/entitlement state |
| `POST /v1/data/exports` | Bearer | Create encrypted account export |
| `GET /v1/data/exports/{jobId}` | Bearer | Download own unexpired export over TLS |
| `DELETE /v1/account` | Owner | Confirm full tenant deletion |
| `GET /v1/audit` | Owner/admin | Read decrypted tenant audit view and chain status |
| `POST /v1/admin/keys/rotate` | Owner | Rotate and re-encrypt tenant data key |

The local-only entitlement transition route is unavailable outside local mode. Backup and restore are operator commands, not Internet API endpoints.

## Sync protocol

Request shape:

```json
{
  "resourceId": "memory.example",
  "resourceType": "memory",
  "schemaVersion": 1,
  "baseVector": { "dev_...": 3 },
  "payload": { "kind": "note", "text": "..." },
  "deleted": false
}
```

Rules:

- `resourceType` is one of `memory`, `conversation`, `preference`, or `reminder`.
- A record is at most 256 KiB in the local baseline. API bodies are at most 1 MiB.
- The client sends the exact vector it last observed. The server increments the authenticated device component.
- A stale or divergent vector returns HTTP 409 with `outcome=conflict` and the current server record. The server never silently selects a winner.
- Deletion is a tombstone (`deleted=true`, `payload=null`) so other devices can observe it.
- `Idempotency-Key` is required for writes and model calls. Reusing a key with different input returns 409; identical replay returns the original result. The stored result is sealed with the tenant key (it contains the record or model answer), re-sealed on key rotation, and removed after 24 hours.
- Unsupported schema versions return a typed error and list supported versions. v2 must use an additive compatibility period or a new media/version path.

This protocol contains no Desktop SQLite schema, SQL statements, filesystem paths, tool calls or Electron objects.

## Retry policy

- Retry `429` and `503` with exponential backoff, full jitter and the returned `retryAfterSeconds` when present.
- Do not retry `400`, `401`, `403`, `404`, `409` or `422` without changing state/input.
- Refresh once after `401 session-expired`; if refresh fails, require login.
- Reuse the same idempotency key for a retry of the same logical write.

## Compatibility policy

API v1 is frozen for Mobile 1.0 consumption only after Cloud production Go. Additive fields may be added; clients must ignore unknown response fields. Required request fields, meanings and enum removal require a new API version. v1 deprecation requires at least 180 days notice, telemetry based only on consented operational metadata, and an upgrade path.
