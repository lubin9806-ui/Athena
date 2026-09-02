# Athena Companion (Android)

Engineering-only first-party client. It talks only to Athena Cloud `/v1`. It does not load Electron, Desktop SQLite, Execute tools, or Live2D.

Current release judgment remains **NO-GO**. Passing local protocol tests is not Play review, Cloud production, or a paid subscription.

## Frozen choices

- ApplicationId: `com.elanastra.athena` (debug suffix `.debug`)
- Min SDK: 29
- Modes: Create / Companion / Reason. Execute is rejected in the client and by Cloud.
- Search: Cloud `POST /v1/search/query` only. The phone does not scrape HTML.
- Billing: sandbox/read-only entitlements. Cloud `local-no-charge` cannot create a charge.

## Run against the local Cloud fixture

```powershell
cd G:\Athena\cloud
npm.cmd start
```

Then open `mobile/android` in Android Studio, use a debug build, and keep the emulator Cloud URL `http://10.0.2.2:8787`. A release flavor with an empty base URL must fail closed.

This machine snapshot did not include Android SDK or a standalone JDK 17, so APK assembly is not claimed. Protocol evidence is:

```powershell
cd G:\Athena
npm.cmd run test:android
```

Expected marker:

`ATHENA_ANDROID_COMPANION_ENGINEERING_OK ... production=no-go`
