# Architecture

Pakka is a React frontend and an Express API with MongoDB. The API calls Gnani for speech and Gemini for language, and a deterministic ledger sits between the model output and anything the user hears.

## Components

| Component | File | Job |
|---|---|---|
| App factory | `backend/src/app.js` | CORS, JSON parsing, routes, error shape |
| Start-up | `backend/src/server.js`, `config.js` | Validates env, connects to MongoDB, listens |
| Routes | `backend/src/routes/sessions.js` | Input checks, then calls `deal.js` and saves the session |
| Orchestration | `backend/src/deal.js` | `runTurn`, `answerClarification`, `confirmDeal` |
| Ledger | `backend/src/ledger.js` | Pure functions: slots, number parsing, number guard, rules A1 to A10, formatting |
| Templates | `backend/src/templates.js` | Fixed questions, option labels, slot names and card lines in gu, hi, en |
| Gnani client | `backend/src/gnani.js` | STT and TTS over REST, disk cache, one-at-a-time queue, retry |
| LLM client | `backend/src/llm.js`, `prompts/analyse.md` | One Gemini call per turn, schema output, validation and coercion |
| Model | `backend/src/models/DealSession.js` | One MongoDB document per deal |
| Frontend | `frontend/src/` | Two speaker panels, conversation log, ledger panel, question panel, confirm card, replay view |

## One turn, step by step

1. The browser records while the button is held (cap 25 s, clips under 0.5 s are ignored), decodes the recording, resamples it to 16 kHz mono and encodes a WAV in JavaScript. A typed message skips this step.
2. The browser sends `POST /api/sessions/:id/turns` with the WAV (multipart `audio`) or JSON `{ speaker, text }`.
3. The route checks the speaker, the WAV header (RIFF and WAVE), the 2 MB size and the 1000 character text limit.
4. `runTurn` rejects the turn if the deal is confirmed, or if a question is pending for the other speaker (409).
5. For audio, `gnani.stt` returns the transcript. An empty transcript is a 422. Results are cached on disk by hash of the audio and language.
6. `analyseTurn` makes one Gemini call with today's date in India, both languages, a brief of the current ledger and the transcript. The answer is validated and coerced: unknown slots, fields and enum values are dropped, numbers must be non-negative.
7. The number guard drops any number from Gemini that does not appear in the transcript, as digits or number words. A dropped number marks its slot `unresolved` and is reported in the response as `dropped`. Gemini dates must be real ISO dates on or after today, and Gemini option patches must pass the same number and date checks.
8. `applyTerms` merges the surviving terms into a copy of the ledger.
9. `checkTerms` runs the deterministic rules (A1 to A6, A8, A10) on that ledger. Gemini flags (A7, A9, A10) are converted into ambiguities with validated options. One ambiguity per slot is asked at a time. Rule results win over Gemini's for the same slot, and Gemini's waits in `pending.deferred` until the rule question for that slot is answered.
10. The result is sorted by priority and becomes the queue.
11. If the queue is empty, the translation is released. The text is the translation, plus one "Confirmed:" line built by code from any slots resolved during this exchange, in the listener's language. `gnani.tts` speaks it in the listener's voice.
12. If the queue is not empty, the translation is held. The first question is read from the fixed template in the speaker's language, spoken with TTS, and returned with tap options.
13. The session (ledger, pending queue, turns) is saved to MongoDB and the result is returned.

Each turn records `latency: { sttMs, llmMs, ttsMs }`. A cached STT or TTS result counts as 0 ms.

## The question queue and rounds

Only one question is open at a time. The pending state is stored on the session as `{ turnIndex, speaker, queue, resolved, followUps, deferred }`. Requests that change one session (turns, clarify, confirm) run one after another through an in-process lock per session id, so none works on a stale copy. Gnani and Gemini calls time out after 20 seconds.

- Order of questions: price (A4, A5, A8, A10), then quantity (A1, A2), then delivery (A3), then payment (A6), then A7, then A9.
- Tap an option: `POST /clarify` applies the option's patch to the ledger. The rules run again on the new ledger, because answering one slot can expose the next gap (for example the price basis after GST). New findings are added to the queue.
- Skip: the slot becomes `unresolved` and leaves the queue. Skipping a changed price (A8) puts the old amount back. A confirm is blocked while any slot is unresolved.
- Voice or text re-answer: a new turn from the pending speaker is analysed as normal and treated as an answer to the open question. Its terms merge into the ledger. Each queued slot is re-checked: if the rule no longer fires, the slot is resolved. If it still fires for the slot that was asked, its `rounds` goes up by one. At 2 rounds the slot becomes `unresolved` and leaves the queue.
- A7, A8 and A9 cannot be re-derived by rules. They stay open until the speaker gives new terms for that slot.
- A turn from the other speaker while a question is pending gets 409.
- When the queue empties, the held translation of the original turn is released, with the "Confirmed:" line. Re-answer turns are released too: one that added terms is spoken with the original, one without is released with its own translation.

Slot status values: `empty`, `ok`, `ambiguous`, `unresolved`. A slot that receives a new term after being unresolved gets `rounds` reset to 0 and is checked again.

## Confirm

`POST /confirm` is blocked (409, with the list of slots in `missing`) unless every slot is `ok` and complete, and no question is pending. Complete means:

| Slot | Required fields |
|---|---|
| quantity | value, unit |
| product | name |
| price | amount, per, gst (currency defaults to INR on the card if empty) |
| delivery | date (an ISO date, not a phrase) |
| payment | balance |

On success the card holds the terms, the text in both languages, the TTS audio URL for both, and a timestamp. The frontend offers it as `pakka-terms.json`.

## Ledger rules

Rules in `ledger.checkTerms` run on the ledger as it would be after the new terms. A slot that is `unresolved` is not checked again. A rule does not fire again for a slot once the speaker has answered it with an option (the answer is stored in `acks`), until a field in that slot changes.

| Id | Slot | Fires when | Options |
|---|---|---|---|
| A1 | quantity | value set, unit empty | meter, roll, kg, piece |
| A2 | quantity | unit is roll, than, bale or lot | switch to meters, keep unit and confirm length later |
| A3 | delivery | raw phrase set and date empty, or the phrase is relative (next, tomorrow, end of, after, and Hindi and Gujarati equivalents) | up to 3 ISO dates from Gemini that pass validation; if none, the next 2 matching weekdays from today (Friday if no weekday named) |
| A4 | price | amount set, GST empty | GST included, GST extra |
| A5 | price | amount set, basis empty | per meter, per kg, per piece |
| A6 | payment | advance percent set, balance empty | on delivery, 30 days after delivery |
| A7 | product | Gemini only: spec could mean two things | 2 to 4 options from Gemini, validated |
| A8 | price | new amount differs from an `ok` ledger price and the speaker used no change word (change, revise, new price, instead and equivalents) | old amount, new amount |
| A9 | any slot | Gemini only: yes or ok after two different proposals | one option per proposal from Gemini |
| A10 | price | currency empty and the transcript mentions dollars (rule), or Gemini flags it | INR, USD |

Gemini's ambiguities are accepted only if the type is A7, A9 or A10. A7 is accepted only for the product slot. An option set with fewer than 2 valid options is dropped.

### Number guard

Numbers that Gemini returns for `quantity.value`, `price.amount` and `payment.advancePct` are kept only if the same number appears in the transcript. The parser reads:

- Latin, Devanagari and Gujarati digits, with commas and decimals.
- Number words 1 to 20 and the tens 30 to 90, in Latin, Devanagari and Gujarati script.
- Multipliers: sau, hazaar, lakh, crore (and spelling variants).
- Fraction words: dedh (1.5), dhai (2.5), sava (+0.25), paune (-0.25), saade (+0.5). "dedh hazaar" is 1500, "sava lakh" is 125000.

A dropped number leaves the field empty and marks its slot `unresolved`, and the response lists it in `dropped`. The speaker is asked to say it again. Limit: Hindi and Gujarati number words from 21 to 99 are not parsed, so a quantity said that way is dropped this way.

## Why a deterministic ledger backs the LLM

- The model is untrusted. It can invent a number, miss a unit or skip a question. Code checks its output before anything is spoken.
- Recall for the common gaps (A1 to A6, A8, A10) depends on rules, not on the model's mood on a given turn.
- Questions and option labels come from fixed templates, so a question cannot be mistranslated. The model only supplies option values for A3, A7 and A9, and code validates them.
- The corrected message is the original translation plus a line built from ledger values, not a second model call.
- The model never writes important state directly. A slot only reaches `ok` through code.

## Data model

One `DealSession` document per deal: `status` (`open` or `confirmed`), `ledger`, `pending`, `turns[]`, `card`, plus timestamps. A turn stores speaker, language, source (`voice` or `text`), transcript, translation, terms, ambiguities, status (`held` or `released`), released text, audio hash and latency.

Audio files are not in MongoDB. They live in `backend/.cache/` and are served at `/api/audio/:hash`. See `OPERATIONS.md`.

## Decisions log

| Id | Topic | Decision | Reason |
|---|---|---|---|
| D1 | Stack | React 19 + Vite + TypeScript + Tailwind v4 in `frontend/`; Express 5 + Mongoose (ESM JavaScript) in `backend/` | MERN was asked for, and it is the default stack. Backend in JavaScript to save time close to the deadline. |
| D2 | Audio format | The browser decodes the MediaRecorder blob with Web Audio, resamples to 16 kHz mono with OfflineAudioContext and encodes WAV in JavaScript | Gnani does not list webm. With no ffmpeg on the server, free hosts work. |
| D3 | LLM | Gemini through REST `generateContent` with `responseSchema`, behind one function `analyseTurn()` in `backend/src/llm.js`. Model from `GEMINI_MODEL`, default `gemini-2.5-flash` (assumption: still available; change the variable if not) | One swap point. |
| D4 | Questions and options | Fixed templates per ambiguity type in gu, hi and en (`backend/src/templates.js`). The LLM only supplies option values for open types, which code validates | Questions cannot be mistranslated and the model never controls important text. A native-speaker check is still needed. |
| D5 | Corrected message | Released text is the original translation plus one deterministic "Confirmed: ..." line in the listener's language, built from the resolved slots | No second LLM call. Values come from the ledger, not the model. |
| D6 | Storage | MongoDB `DealSession` documents (turns, ledger, pending queue, card) | MERN, and replay needs stored sessions. |
| D7 | Credit saving | Gnani STT and TTS results are cached on disk in `backend/.cache/`, keyed by sha256 of the input. TTS audio is served from that cache at `/api/audio/:hash` | 5,000 credits and an unknown cost per call. |
| D8 | Concurrency | All Gnani calls go through one in-process queue (one active request). 429 and 5xx responses are retried after 0.5 s, 1 s and 2 s | The Gnani docs say 1 active request per key by default and give no Retry-After. |
| D9 | Models | STT `prisma-v3.0` with `format=transcribe` (digits). TTS `timbre-v3.0`, voices from env (default seller `Shivani`, buyer `Avinash`). Assumption: confirm the voices by ear in the first live smoke test | v3.0 voices speak every language, which avoids voice and language 400 errors. |
| D10 | Language pair | `SELLER_LANG=gu-IN`, `BUYER_LANG=hi-IN` from env | A fallback to Hindi and Tamil is a config change (Tamil templates are not written). |
| D11 | Council | No new council was run for the stack. The idea and plan already went through a council and an arena on 3 Nov, and the user fixed the stack | Four days were left. |

### Amendments during the build (6 Nov 2026)

| Topic | What changed | Reason |
|---|---|---|
| LLM scope | Gemini may flag only A7, A9 and A10. Rules own A1 to A6 and A8. Gemini options use `{ label, field, value }` instead of a free patch | Keeps the model away from rules code can check. Code builds the patch. |
| Lint | oxlint instead of ESLint | It ships with the current Vite template. |
