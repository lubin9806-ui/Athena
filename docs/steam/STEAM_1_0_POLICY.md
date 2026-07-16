# Athena Steam 1.0 SKU Policy

> Window 08 / ATH-STEAM-001 engineering policy. Baseline date: 2026-07-16. This is not evidence of a Steam release or Valve approval.

## SKU identity

- SKU: `athena-steam-personal-v1`
- Display name: Athena Steam 1.0
- Platform claim: Windows x64 only
- Executable: `AthenaSteam.exe`
- App identity: `com.athena.steam`
- Delivery and updates: SteamPipe only; the Desktop Direct updater is disabled in the Steam runtime.
- AppID and DepotID: supplied only by the real release environment. The repository keeps both `null`, rejects AppID 480, and never ships `steam_appid.txt`.

## Launch and ownership

The main process performs this sequence before showing Athena:

1. Load the immutable packaged `steam/steam-runtime.json`.
2. Call `restartAppIfNecessary(AppID)`.
3. Initialize Steamworks in the Electron main process.
4. Require the active Steam AppID to equal the packaged AppID.
5. Require `ISteamApps::BIsSubscribed` through the native bridge.
6. Require a valid SteamID and the expected private test branch before candidate review.
7. Fail closed with no application window if any check fails.

The sandboxed renderer never receives the Steamworks native module or SteamID.

## Steam launch capability boundary

Steam 1.0 excludes these capabilities at launch:

- Full Execute and every tool whose minimum permission is `full`
- persistent or one-shot terminals and command execution
- program launch, arbitrary path opening, arbitrary HTTP/HTTPS and TCP port probing
- web search and deep page reading
- opening arbitrary external links from the app
- external payments, external purchase links, subscriptions, and non-Steam checkout

The boundary is enforced in settings sanitization, tool enumeration, direct tool execution, navigation handling, and renderer controls. Steam can still communicate with its own client through Steamworks, and Athena can use a user-configured local Ollama endpoint for local inference.

## Steam Cloud

Window 03 explicitly recorded that Steam Cloud was not implemented or approved. Therefore:

- `config/steam.json` contains an empty whitelist and `cloud.enabled=false`.
- Runtime Cloud stays disabled even when Steam account/app Cloud is enabled.
- No settings, chats, memories, database, logs, model files, voice files, or machine paths are synchronized.
- The implemented record protocol uses AES-256-GCM payloads, per-device vector clocks, bounded records, tombstones for deletion propagation, and explicit conflict results with no silent overwrite.
- Real Cloud enablement requires a dated Window 03 approval amendment naming every relative path, remote name, personal-data status, and byte limit. It also requires a cross-device key-custody decision and real Steam Cloud tests.

## External blockers

Steam release remains Blocked until the project owner supplies a real Steamworks partner account, AppID, DepotID, tax/bank/Steam Direct completion, Steamworks SDK access, private branch ownership test, Steam Cloud decision, clean-machine redistributable proof, production signing identity, and Valve Store Presence/build review.

References: [Steamworks API overview](https://partner.steamgames.com/doc/sdk/api), [ISteamApps](https://partner.steamgames.com/doc/api/ISteamApps), [Steam review process](https://partner.steamgames.com/doc/store/review_process).
