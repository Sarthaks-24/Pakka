# API

Base URL: `http://localhost:4000` (set by `PORT`). All bodies are JSON unless stated. There is no authentication. CORS allows only the origins in `FRONTEND_ORIGIN` (a comma-separated list; `localhost` and `127.0.0.1` forms both work).

## Errors

Every error has this shape, with a message that says what happened and what to do. Messages never contain keys or stack traces.

```json
{ "error": "Session not found. Start a new session." }
```

The confirm endpoint adds a `missing` array on 409:

```json
{ "error": "Cannot confirm yet. These terms are not settled: delivery, payment. Answer the open question or say them again.", "missing": ["delivery", "payment"] }
```

| Status | When |
|---|---|
| 400 | Bad speaker, missing audio and text, text over 1000 characters, bad option, invalid JSON, bad audio id, recording longer than 25.5 seconds |
| 404 | Unknown or malformed session id, audio not in the cache, unknown route |
| 409 | Deal already confirmed, other speaker's question is pending, no question is waiting, cannot confirm yet |
| 413 | Audio over 2 MB, JSON body over 100 KB |
| 415 | Upload is not a WAV file |
| 422 | No speech heard in the recording |
| 502 | Gnani or Gemini rejected the request, was unreachable or returned an unreadable answer (key, credit, scope and model problems are named in the message; upstream error text is never forwarded) |
| 504 | Gnani or Gemini did not answer within 20 seconds |
| 503 | Gnani or Gemini is rate limited after retries |
| 500 | Anything unexpected |

## Shapes

### Session

```json
{
  "id": "6730a1f2c3d4e5f6a7b8c9d0",
  "status": "open",
  "ledger": {
    "quantity": { "value": 500, "unit": "meter", "status": "ok", "rounds": 0, "acks": ["A1"] },
    "product":  { "name": "cotton", "spec": null, "status": "ok", "rounds": 0, "acks": [] },
    "price":    { "amount": 118, "currency": null, "per": "meter", "gst": "extra", "status": "ok", "rounds": 0, "acks": ["A4", "A5"] },
    "delivery": { "date": null, "raw": "next Friday", "status": "ambiguous", "rounds": 0, "acks": [] },
    "payment":  { "advancePct": 30, "balance": null, "status": "empty", "rounds": 0, "acks": [] }
  },
  "pending": null,
  "turns": [],
  "card": null,
  "createdAt": "2026-11-06T09:30:00.000Z",
  "updatedAt": "2026-11-06T09:31:10.000Z"
}
```

- Slot `status` is `empty`, `ok`, `ambiguous` or `unresolved`.
- `pending` is `null` or `{ turnIndex, speaker, queue, resolved }` while a question is open. `queue` holds the full ambiguity objects (`id`, `type`, `slot`, `quote`, `options` with `label` in gu, hi and en and a `patch`). The frontend does not need it.
- `status` is `open` or `confirmed`. `card` is `null` until confirmed.

### Turn

```json
{
  "speaker": "seller",
  "lang": "gu-IN",
  "source": "text",
  "transcript": "...",
  "translation": "...",
  "terms": { "quantity": { "value": 500 }, "price": { "amount": 118 } },
  "ambiguities": [ { "id": "A1:quantity", "type": "A1", "slot": "quantity", "quote": "...", "options": [] } ],
  "status": "released",
  "releasedText": "...",
  "audioHash": "9f2c...64 hex characters",
  "latency": { "sttMs": 0, "llmMs": 1840, "ttsMs": 2210 }
}
```

`status` is `held` until the translation is released. When a question is answered, every turn of that exchange is released, including re-answers. `source` is `voice` or `text`. `lang` is the speaker's language code. `audioHash` is `null` while held.

### TurnResult

Returned by `/turns` and `/clarify`. When the number guard removed a number the model invented or the parser could not read, the result also has `dropped: [{ slot, field }]` and that slot is `unresolved`, so the speaker must say it again.

```json
{
  "session": { "...": "Session" },
  "turn": { "...": "Turn" },
  "outcome": "clarify",
  "clarification": {
    "ambiguityId": "A4:price",
    "slot": "price",
    "type": "A4",
    "question": { "text": "આ ભાવ GST સાથે છે કે GST અલગથી?", "lang": "gu-IN" },
    "options": [
      { "id": "included", "label": "GST સાથે" },
      { "id": "extra", "label": "GST અલગથી" }
    ],
    "audioUrl": "/api/audio/3b1d...64 hex characters"
  }
}
```

When the translation is released, `outcome` is `released` and there is a `release` object instead of `clarification`:

```json
{
  "session": { "...": "Session" },
  "turn": { "...": "Turn" },
  "outcome": "released",
  "release": {
    "text": "<translation>\nपक्का हुआ: भाव 118 रुपये प्रति मीटर, GST अलग से",
    "lang": "hi-IN",
    "audioUrl": "/api/audio/7c0e...64 hex characters"
  }
}
```

- `clarification.question.lang` is the speaker's language. Option labels are in that language and fall back to English.
- `release.lang` is the listener's language.
- `audioUrl` values are paths on this API. Prefix them with the base URL.
- If a re-answer by voice or text releases an earlier held turn, `turn` is the new turn, and the released turn is in `session.turns` at `pending.turnIndex`.

### Option ids by type

| Type | Option ids |
|---|---|
| A1 | `meter`, `roll`, `kg`, `piece` |
| A2 | `meter` (switch to meters), `keep` |
| A3 | `d0`, `d1`, `d2` (candidate dates, up to 3) |
| A4 | `included`, `extra` |
| A5 | `meter`, `kg`, `piece` |
| A6 | `b0` (on delivery), `b1` (30 days after delivery) |
| A7, A9 | `o0` to `o3` |
| A8 | `old`, `new` |
| A10 | `INR`, `USD` |

The `ambiguityId` is `<type>:<slot>`, for example `A3:delivery`.

### Card

```json
{
  "terms": {
    "quantity": { "value": 500, "unit": "meter" },
    "product": { "name": "કોટન કાપડ", "spec": null, "nameTranslated": "कॉटन कपड़ा", "nameLang": "gu-IN" },
    "price": { "amount": 118, "currency": "INR", "per": "meter", "gst": "extra" },
    "delivery": { "date": "2026-11-13", "raw": "next Friday" },
    "payment": { "advancePct": 30, "balance": "on delivery" }
  },
  "text": {
    "seller": "નક્કી થયેલી શરતો\nજથ્થો: 500 મીટર\n...",
    "buyer": "पक्की शर्तें\nमात्रा: 500 मीटर\n..."
  },
  "audioUrl": {
    "seller": "/api/audio/<64 hex characters>",
    "buyer": "/api/audio/<64 hex characters>"
  },
  "confirmedAt": "2026-11-06T09:45:12.000Z"
}
```

`product.nameTranslated` is the product name in the other side's language, from Gemini. Each side of the card uses the name in its own language; `nameLang` is the language the name was said in.

Example values are synthetic.

## Endpoints

### GET /api/health

200 `{ "ok": true }`

### POST /api/sessions

Creates an empty session. No body. 201 with a Session.

### GET /api/sessions

The 20 most recent sessions, newest first. 200:

```json
[ { "id": "6730a1f2c3d4e5f6a7b8c9d0", "createdAt": "2026-11-06T09:30:00.000Z", "status": "open", "turnCount": 3 } ]
```

### GET /api/sessions/:id

200 with a Session. 404 if the id is not a 24 character hex string or is not found.

### POST /api/sessions/:id/turns

Sends one spoken or typed turn. Two forms.

Audio, `multipart/form-data`:

| Field | Value |
|---|---|
| `speaker` | `seller` or `buyer` |
| `audio` | one WAV file, max 2 MB (16 kHz mono from the browser) |

```powershell
curl.exe -X POST http://localhost:4000/api/sessions/6730a1f2c3d4e5f6a7b8c9d0/turns -F speaker=seller -F "audio=@turn.wav;type=audio/wav"
```

Text, JSON:

```json
{ "speaker": "seller", "text": "500 meter chahiye, bhaav 118" }
```

Text is trimmed and must be 1 to 1000 characters. Responds 200 with a TurnResult.

If a question is pending, a turn from the same speaker is a re-answer to it. A re-answer that adds terms is spoken together with the original translation; one without new terms is released with its own text. A turn from the other speaker is 409. After two rounds on the asked slot without a clear answer, the slot becomes `unresolved`.

### POST /api/sessions/:id/clarify

Answers the open question.

```json
{ "optionId": "extra" }
```

or leave it unresolved:

```json
{ "skip": true }
```

`optionId` must be a string of at most 64 characters and one of the listed option ids, otherwise 400. With no pending question: 409. Responds 200 with a TurnResult. The result is either the next question (`outcome: "clarify"`) or the released translation (`outcome: "released"`).

### POST /api/sessions/:id/confirm

No body. 200 `{ "session": Session, "card": Card }` and the session becomes `confirmed`. Calling it again on a confirmed session returns the same card. 409 with `missing` if any slot is not `ok` and complete, or a question is pending.

### GET /api/audio/:hash

Returns `audio/wav` from the disk cache. `:hash` must be 64 lowercase hex characters (400 otherwise). 404 if the file is not in the cache.
