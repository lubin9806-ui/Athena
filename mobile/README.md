# Athena Mobile connection boundary

This first mobile slice claims a short-lived Desktop pairing offer and stores a
normal, revocable Cloud device session through a host-provided
`MobileSessionStore`.

It is not an Android/iOS app, store submission, or production-Cloud claim. A
native shell must provide Android Keystore or iOS Keychain storage before it
uses `AthenaMobileConnectionClient`; there is no insecure file or local-storage
fallback in this package.

## Desktop-to-phone hand-off

Desktop emits a transient URI such as:

```text
athena://pair?version=1&server=https%3A%2F%2Fcloud.example&code=123456
```

The URI has only the public Cloud endpoint and a six-digit, single-use,
90-second code. It never carries access or refresh tokens. The native shell may
receive it through an app link, QR scan, or paste field and pass it to
`pairFromUri()`.

Release clients reject cleartext endpoints. `localhost`, `127.0.0.1` and
`10.0.2.2` are available only when an explicit development option is supplied
for the local emulator integration test.

## Verify

```powershell
cd G:\Athena
npm.cmd --prefix mobile test
```

The test starts the local Cloud fixture, creates a desktop offer, lets the
mobile client claim it, checks the server device list, and verifies logout
revokes that mobile device. It is not physical-phone or production-Cloud proof.
