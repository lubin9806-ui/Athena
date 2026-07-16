# Steam AI Content Disclosure Draft

> Questionnaire drafting source only. The release owner must enter and submit the answers in Steamworks. No questionnaire or Valve review has been completed.

## Pre-generated AI content

Yes.

The Steam store/library capsule artwork and ATHENA wordmark candidates under `assets/steam/` were generated and edited with OpenAI image generation on 2026-07-16, then mechanically cropped/resized for Steam formats. The art direction uses a restrained Athens-inspired visual system: Aegean indigo, Pentelic-marble geometry, olive details, and translucent pale-jade glass. Source masters, generated derivatives, prompts, and provenance status are recorded in `STEAM_ASSET_MANIFEST.md` and `docs/ASSET_PROVENANCE.md`.

The five files under `assets/steam/screenshots/` are not AI-generated images. They are direct 16:9 captures at or above 1920x1080 from the compiled Athena Electron runtime. They are source candidates only and must be replaced or reconfirmed from the real Steam AppID near-final build.

Human review still must confirm trademark clearance, originality, absence of third-party protected characters/logos, PG-13 suitability, text accuracy, and consistency with the shipped build.

## Live-generated AI content

Yes.

Athena generates conversational text at runtime through a user-configured local Ollama model. Steam 1.0 does not sell external AI credits, link to an external checkout, or include an online model service. The current default local model configuration is `qwen2.5:14b`; the Steam depot does not redistribute the model or the user's Ollama directory.

## Guardrails represented by the build

- Steam-specific system instructions prohibit sexual content involving minors and actionable assistance for serious violent wrongdoing, human trafficking, credential theft, and malware abuse.
- Deterministic input and output checks block high-confidence patterns in those categories.
- Steam output is buffered before display so the output check runs before any generated text reaches the renderer.
- Full Execute, terminals, arbitrary program launch, arbitrary HTTP/TCP, web search, and external links are disabled in the Steam SKU.
- Block events log only category and length metadata, not the blocked text.
- The refusal redirects toward prevention, safety, compliance, help-seeking, or non-actionable fictional treatment.

## Limitations that must be disclosed internally

The deterministic guardrail is not a complete moderation system and cannot guarantee coverage across all languages, obfuscations, contexts, or jurisdictions. Before submission, QA must run an approved multilingual adversarial set and document false negatives/positives. Legal/Product must decide whether the current local-model guardrail is sufficient for the intended territories. Do not state or imply that all illegal output is technically impossible.

Steam requires disclosure of both pre-generated content consumed by users and live-generated content, with a description of live guardrails. See the [Steam Content Survey](https://partner.steamgames.com/doc/gettingstarted/contentsurvey).
