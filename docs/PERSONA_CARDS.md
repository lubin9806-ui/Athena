# Athena Persona Cards

Athena uses one persona system for both private and public builds. A persona is
not hard-coded into the prompt builder. It is a structured card selected by
`settings.profile`.

## Reference Shape

The structure borrows proven concepts from mature roleplay clients without
copying their implementation:

- Character Card: who the assistant is, how it speaks, and what boundaries it
  must keep.
- User Personalization: how the assistant should address the user and tune tone,
  length, initiative, and creative hints.
- Lore / Context: project instructions and memory remain separate from the
  persona card.
- Prompt Preview: every selected card resolves into a deterministic system
  prompt section that tests can inspect.

## Built-In Default

Public builds contain the built-in `athena-neutral` card. It is a warm,
local-first desktop assistant persona and does not contain private developer
identity, memories, relationship framing, or roleplay material.

`settings.profile = "default"` first tries to load a local private default card.
If none exists, it falls back to `athena-neutral`. This lets the owner keep a
private default locally while release packages remain neutral.

## Local Card Locations

Cards are JSON files with `schemaVersion: 1`. Athena resolves cards in this
order:

1. `ATHENA_PERSONA_FILE`
2. `ATHENA_PERSONA_DIR/<profile>.persona.json`
3. `ATHENA_PERSONA_DIR/<profile>.json`
4. `config/personas/<profile>.persona.json`
5. `personality/private/<profile>.persona.json`
6. `personality/private/<profile>.json`
7. `personality/<profile>.persona.json`
8. built-in `athena-neutral`

`personality/private/` is ignored by Git and is not included by the current
Electron packaging rules.

## Card Fields

Core fields:

- `id`, `displayName`, `nickname`, `visibility`, `role`
- `identity`, `relationshipFrame`, `tags`
- `prompt.priorityRules`, `traits`, `speakingStyle`, `roleplayNotes`
- `prompt.selfIntroductionRules`, `selfIntroductionExample`
- `prompt.dailyHabits`, `presenceRules`, `boundaries`
- `prompt.memoryRules`, `workRules`
- `memoryPolicy`
- `toolPolicy`
- `timeMoods`

The runtime sanitizes string lengths, array sizes, booleans, and missing fields
before the card reaches the prompt builder.

## Release Rule

Public release verification must prove:

- compiled `dist/` does not contain private persona names or IDs;
- packaged apps do not include ignored private cards;
- the default prompt resolves to `athena-neutral` when no local private default
  exists;
- user-created cards remain local data, not product claims.
