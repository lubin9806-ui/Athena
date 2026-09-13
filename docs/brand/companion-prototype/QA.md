# Companion prototype QA

This harness tests the standalone design prototype in this directory. It does not launch Athena, read personal configuration, access memory databases, or call a model. The browser uses an isolated temporary profile, denies device permissions, and blocks/report any HTTP or WebSocket request.

Run from `G:\Athena` after the prototype files are present:

```powershell
$athenaQaProcess = Start-Process -FilePath 'G:\Athena\node_modules\electron\dist\electron.exe' -ArgumentList 'G:\Athena\docs\brand\companion-prototype\verify.cjs' -WindowStyle Hidden -PassThru -Wait
$athenaQaProcess.ExitCode
```

The Electron window stays hidden and uses offscreen painting at 30 fps with hardware acceleration disabled. A hidden native window can suspend the compositor timeline even with `backgroundThrottling: false`; that produces false animation-completion, pointer-frame and transition-color failures. Offscreen rendering lets actual animations advance without displaying a window on the user's desktop. The run writes results to `evidence/qa-report.json`, plus screenshots at 1440×900, 1280×800, 960×720 and 390×844 in day and night themes. A successful run prints `ATHENA_COMPANION_PROTOTYPE_OK`; failure prints the named checks and returns exit code 1.

Coverage includes input enablement, prompt insertion, canned response completion, cancel without a late reply, demo error and retry, example/new conversation, theme switching, sidebar switching, keyboard tabs, popover spacing, mutually exclusive panels, Escape focus return, drawer keyboard focus, horizontal overflow, essential control bounds, image loading, foreground contrast, and reduced motion. Motion/material checks include immediate inert exit state, rapid reopening, stable two-level navigation, retained drafts, retained old message nodes, scroll preservation, return-to-latest, multi-line composer layering, pointer/pressure/reset, opaque fallback, and idle frame counts.

The popover must sit at least 10 px above the composer. Text contrast is checked at 4.5:1 and active icon controls at 3:1 from computed styles; disabled controls are excluded. The sliding selected-tab pseudo-element is included in its background calculation. These are uniform-color estimates, not per-pixel contrast guarantees for optical highlights. The reduced-motion user control is checked against computed durations and running animations, while operating-system support is checked for the corresponding media rule. Screenshots require human visual review for composition, glyph quality, and perceived comfort. OS media preferences and forced-color fallback still need platform-level manual review.

The evidence is for the clickable prototype only. It does not establish production integration, real LLM response quality, screen-reader usability, provider availability, or packaged-app readiness. Synthetic keyboard events exercise the DOM handlers; native input and assistive technology remain separate manual checks.

Latest verified baseline: 2026-09-10, 54 checks passed, 0 failed, 15 screenshots. Daylight, dark, narrow-screen, settings and popover captures were visually reviewed. The drawer focus test includes accordion summaries and excludes controls inside closed details. Closing the tools drawer returns focus to the visible plus button because the tools menu item is no longer visible. Inspect the timestamp and `passed` field of `evidence/qa-report.json` for the latest actual run.

`diagnose-motion.cjs` is a short isolated timing diagnostic; it writes `evidence/motion-diagnostic.json` and is not the acceptance harness. Production GPU frame pacing and 60/120 Hz perceptual smoothness are not established by this software-rendered 30 fps verification.
