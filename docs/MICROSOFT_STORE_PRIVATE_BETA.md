# Microsoft Store Private Beta

> Product status: draft. Store submission, certification and Private Audience distribution have not happened yet.

## Partner Center identity

| Field | Value |
|---|---|
| Product name | Athena AI companion |
| Store ID | `9NT09L9504R1` |
| Package identity | `AthenaL.AthenaAIcompanion` |
| Publisher | `CN=3D06B086-15FC-4F75-8056-021840D60F44` |
| Publisher display name | `Athena L` |
| Package family name | `AthenaL.AthenaAIcompanion_gf9pv7kh6znee` |
| Audience | Private only |

These identifiers are public package metadata. Account credentials, identity documents and Partner Center authentication tokens must never enter this repository.

## SKU boundary

- Windows x64 Electron application packaged as AppX/MSIX for Microsoft Store certification.
- Store package identity is separate from Desktop Direct and Steam.
- User data uses the `Athena Microsoft Store` directory to prevent concurrent Direct/Store builds from sharing a writable database.
- Updates are managed only by Microsoft Store; `electron-updater`, `app-update.yml` and the Direct HTTPS feed are disabled for this SKU.
- Store package version uses `0.9.<build>.0`; the initial private package is `0.9.1.0`, and later submissions must increase `ATHENA_STORE_BUILD_NUMBER`. The fourth component stays `0` because it is reserved by Microsoft Store.
- The package does not contain OllamaSetup.exe, a local model payload, user databases, logs, `.env`, Steam runtime files or external payment links.
- The packaged seed database is created from a new empty file. Messages, user profile facts, events, project notes, memory index and activity records must all be zero, with no SQLite freelist pages. Su Shixia's personality remains in the canonical code prompt and is not stored as user memory.
- The Store package excludes the tracked development `config/settings.json`; each new user starts from runtime defaults, sees the first-run privacy state, and receives no developer personalization.
- The Store package excludes legacy `skills/actions.js` plus Direct, Steam and operations product configs. Package verification opens the final ASAR and fails closed on developer paths, common credential formats, hard-coded API keys or cross-SKU files.
- Outbound search and tool networking remain separately consented. Full-trust, local network and microphone capabilities are declared because Electron, local Ollama and optional local voice require them.

## Engineering commands

```powershell
npm.cmd run test:store
npm.cmd run build:store
$artifact = Get-ChildItem -LiteralPath release-store -File | Where-Object { $_.Extension -in '.appx', '.msix' } | Select-Object -First 1
npm.cmd run store:verify-package -- --artifact $artifact.FullName
```

`build:store` requires a clean checkout. `build:store:engineering` exists only for local source validation and must not be uploaded.

The tracked supply-chain manifest records Store source assets and packaging decisions. Candidate-specific AppX hashes belong to the ignored build artifact and Partner Center submission evidence; they are verified by `store:verify-package` instead of being written back into the source commit.

For a later submission, set a larger third version component before the clean build, for example `$env:ATHENA_STORE_BUILD_NUMBER='2'`, which produces `0.9.2.0`. Partner Center will reject reuse of an already submitted package version.

## Restricted capability justification

The AppX declares `runFullTrust` because Athena is an Electron/Win32 desktop application. Paste the following truthful explanation into Partner Center's **Submission options** restricted-capability field:

> Athena AI companion is an Electron-based Win32 desktop application packaged as AppX. It requires runFullTrust to start the Electron desktop process, communicate with the user-installed local Ollama service on 127.0.0.1, and run optional on-device voice and user-approved desktop helper processes. The application runs at the current user's medium integrity level and does not request administrator elevation. Execute tools are disabled by default and remain protected by explicit permission tiers and confirmation for high-risk actions.

## Partner Center handoff

1. Create a submission for the reserved product.
2. Keep Pricing and availability set to Free and Private Audience.
3. Create a known user group starting with the developer's own Microsoft account.
4. Upload only an artifact that passed `ATHENA_STORE_PACKAGE_OK`.
5. Complete privacy URL, support contact, age rating, properties and accurate Store listing.
6. Submit for certification; do not call the package signed or approved before Partner Center returns certification evidence.
7. Install from the authenticated private Store link and archive first-install, launch, update, uninstall and data-retention results.
8. Use Package Flights for later tester subsets after the initial private submission is published.

The Store signs an accepted AppX/MSIX package. This does not sign or authorize the separate NSIS Direct build or Steam depot.
