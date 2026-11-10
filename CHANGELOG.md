# Changelog

## 0.1.1, 10 Nov 2026

First live run with real Gnani and Gemini keys.

### Changed

- Gemini calls that answer 500 or 503, or time out, are retried up to 3 attempts with a short pause. The free tier often answers "model experiencing high demand".
- New optional variable `GEMINI_THINKING_LEVEL` (`minimal`, `low`, `medium` or `high`). `minimal` measured about 3 s per turn on `gemini-3.6-flash` against 13 s or more at the model default. An unknown value stops the server at start-up.
- Default `GEMINI_MODEL` is now `gemini-3.6-flash`. `gemini-2.5-flash` answered 404 on 10 Nov 2026.
- Added `docs/PITCH.md`, a one-page solution pitch.

### Verified live

- Gnani Prisma transcribed a Gujarati clip in 4.1 s and a Hindi clip in 1.7 s, close to word for word.
- A full deal ran end to end: Gujarati seller, 4 held questions, Hindi release with Timbre audio, a Hindi counter-offer caught as a changed price, and a confirmed card in both languages.

### Known limits

- The Gemini free tier allows 5 requests a minute and 20 a day per model. The 30-dialogue eval needs more than 20 calls, so precision and recall are still not measured.
- `gemini-3.5-flash-lite` at `minimal` sometimes returns no terms for a sentence without commas. Use a full Flash model for demos.
- The product name on the Hindi card stays in the seller's words (for example Gujarati script).

## 0.1.0, 6 Nov 2026

First working version of Pakka, built for the Great Indian AI Internship Challenge.

### What works

- Two hold-to-talk panels (pointer and keyboard), 25 second cap, clips under 0.5 seconds ignored, and a "type instead" box for each speaker.
- Recordings are converted to 16 kHz mono WAV in the browser and sent to the API.
- Speech to text with Gnani Prisma and text to speech with Gnani Timbre, with a disk cache, a one-at-a-time queue and retries.
- One Gemini call per turn for translation, extracted terms and flags for unclear spec, ambiguous assent and currency.
- A deterministic ledger with rules A1 to A10, a parser for Indian number words and digits, and a number guard that drops numbers not found in the transcript.
- A hold-and-ask gate: unclear terms hold the translation, the speaker gets one fixed-template question with tap options or Skip, and at most 2 rounds per slot before it is marked unresolved.
- Confirm is blocked until every term is settled. The card shows in both languages, is read aloud and downloads as JSON.
- Sessions are stored in MongoDB. A Replay view steps through stored sessions and is always labelled as a replay.
- 30 labelled dialogues and an eval script that prints precision and recall per type and overall.
- Tests for the ledger, the routes (Supertest with an in-memory MongoDB and mocked providers), the Gemini output checks, the eval scorer and the WAV encoder.
- Docs: README, architecture, API, environment and operations.

### Known limits

- The eval has not been run with a real key, so no precision or recall numbers exist yet.
- No live smoke test with real Gnani and Gemini keys has been run. Microphone capture and audio playback were not tested in a real browser session.
- Gujarati and Hindi question, option and card text has not been checked by a native speaker.
- Numbers are sent to TTS as digits, not words.
- Single laptop, push-to-talk only. No accounts, no authentication, no streaming, not deployed.
- The number-word parser covers 1 to 20, the tens, hundred, thousand, lakh, crore and the fraction words dedh, dhai, sava, paune and saade.
- The Gemini model name `gemini-2.5-flash` is an assumption. Change `GEMINI_MODEL` if it is unavailable.
- The 25 second cap is enforced in the browser only. The server limits uploads to 2 MB.
- Synthetic data only.
