const MICROPHONE_GRANT_TTL_MS = 15_000;

let microphoneGrantExpiresAt = 0;

export function armMicrophoneGrant(): void {
  microphoneGrantExpiresAt = Date.now() + MICROPHONE_GRANT_TTL_MS;
}

export function consumeMicrophoneGrant(): boolean {
  const allowed = Date.now() <= microphoneGrantExpiresAt;
  microphoneGrantExpiresAt = 0;
  return allowed;
}

export function hasMicrophoneGrant(): boolean {
  return Date.now() <= microphoneGrantExpiresAt;
}

export function revokeMicrophoneGrant(): void {
  microphoneGrantExpiresAt = 0;
}
