# Multilingual Stories Implementation Plan

**Goal:** Create English source scenarios and image instructions. Store subtitles and audio per selected language. Use Romanian on the Romanian site.

**Architecture:** Keep the existing scenario as the source. Save complete translations and per-page audio references in a separate story_localizations table, with a filesystem equivalent. Project the selected language at the read boundary. Use a separate low-cost translation request and record its actual cost. Share images between all languages.

**Scope:** The user authorized implementation, tests, commit, and push. Keep existing workspace edits outside this branch. Do not deploy or run production migrations.

## Tasks

- [x] Add localization types, translation validation, source-content hashes, storage, and a tested migration. Preserve existing stories under their actual source language.
- [x] Integrate English source creation, final translation and audio, selected-language reads, subtitle generation, audio repair, and per-language page edits. Enforce owner access and generation locks.
- [x] Update language selection, settings actions, API query keys, and offline records. Keep Romanian site output in Romanian.
- [x] Run server tests, both TypeScript checks, the production build, and a browser check. Obtain an independent code review. Fix material findings, commit, and push.

## Review focus

- A saved Romanian track must not replace English text or another language audio.
- Repeated requests must reuse saved translations and completed audio pages.
- Legacy stories retain the actual language of their source content.
- Source edits must invalidate saved translations without changing shared image ownership.
- A reader must not charge another user by opening a language that is not saved.

## Verification

- All 376 server tests passed, including the full migration history in PGlite.
- All 14 frontend tests passed. Both TypeScript checks and the production build passed.
- Real story settings components rendered for English and Romanian site configurations.
- A live English-to-Romanian translation and an ElevenLabs MP3 sample succeeded. The translation request cost $0.00036525.
- Independent review found three faults: list language, reader state during language changes, and an owner check. Regression tests cover the corrections.
- Local browser use was disabled in Work settings. No visual browser check was possible. No production migration or deployment was run.
