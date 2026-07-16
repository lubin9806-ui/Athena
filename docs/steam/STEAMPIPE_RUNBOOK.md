# SteamPipe and Test Branch Runbook

## Build inputs

The following values must come from the real Steamworks release environment. Do not commit credentials or substitute Spacewar AppID 480.

```powershell
$env:ATHENA_STEAM_APP_ID='<real app id>'
$env:ATHENA_STEAM_DEPOT_ID='<real windows depot id>'
$env:ATHENA_STEAM_TEST_BRANCH='steam-internal'
$env:STEAMWORKS_SDK_PATH='<path to real Steamworks SDK>'
$env:CSC_LINK='<code signing certificate reference>'
$env:CSC_KEY_PASSWORD='<provided outside the repository>'
npm.cmd run build:steam
```

The build produces `release-steam/win-unpacked` and generated SteamPipe VDF files under `.build/steamworks`. It does not log into Steam, upload a depot, or set a build live.

## Upload control

1. Use a dedicated Steamworks build account with only the required App/Publish permissions.
2. Review generated VDF files and candidate hashes.
3. Run `steamcmd +login <build-account> +run_app_build <absolute app_build_athena.vdf> +quit` from the real SDK environment. Enter Steam Guard interactively; never store a password in scripts.
4. In Steamworks, assign the uploaded BuildID only to the password-protected `steam-internal` branch.
5. Install from a clean Windows x64 machine using an account that owns the real AppID.
6. Run `npm.cmd run steam:verify-candidate -- --candidate release-steam\win-unpacked` on the staged artifact and archive the output.
7. Do not promote to `default`; only the release owner may do so after Store Presence and build review.

## Depot and redistributables

- One Windows x64 content depot is generated from `release-steam/win-unpacked`.
- Source maps, TypeScript declarations, `steam_appid.txt`, Ollama installers, model stores, and Desktop updater configuration are excluded.
- The native bridge requires `steam_api64.dll` and `steamworksjs.win32-x64-msvc.node`; the candidate verifier checks both.
- Enable Steamworks Microsoft Visual C++ Redistributable 2015–2022 (x64), then verify it on a clean machine. See `steamworks/REDISTRIBUTABLES.md`.

SteamPipe supports private beta branches and requires the Steamworks SDK/SteamCMD on the upload machine. See [Uploading to Steam](https://partner.steamgames.com/doc/sdk/uploading) and [InstallScripts](https://partner.steamgames.com/doc/sdk/installscripts).
