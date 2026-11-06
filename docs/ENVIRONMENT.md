# Environment

All configuration comes from environment variables. Each service has a tracked `.env.example` and an ignored `.env`. Never commit `.env`. Never paste a key into chat or an issue.

The backend loads `backend/.env` through Node's `--env-file-if-exists` flag (Node 22). It checks the required variables at start-up and exits with a message that names the missing variable. Values are never printed.

## backend/.env

Copy with `cd backend; copy .env.example .env` (PowerShell).

| Variable | Purpose | Required | Default | Where to get it |
|---|---|---|---|---|
| `MONGODB_URI` | MongoDB connection string for sessions | Yes | none (the example file has `mongodb://127.0.0.1:27017/pakka`) | Local MongoDB, or a MongoDB Atlas free M0 cluster |
| `GNANI_API_KEY` | Key for Gnani Prisma STT and Timbre TTS, sent as `X-API-Key-ID` | Yes | none | app.gnani.ai/voice |
| `GEMINI_API_KEY` | Key for Gemini translation and ambiguity analysis | Yes | none | aistudio.google.com |
| `GEMINI_MODEL` | Gemini model name used in the request URL | No | `gemini-2.5-flash` | Model list in Google AI Studio. Change it if the model is retired (the API then answers "The model in GEMINI_MODEL was not found") |
| `PORT` | Port the API listens on | No | `4000` | Any free port. Update `VITE_API_URL` to match |
| `FRONTEND_ORIGIN` | Browser origin allowed by CORS. A comma-separated list is accepted. A `localhost` origin also allows its `127.0.0.1` form | No | `http://localhost:5173` | The address the frontend is served from |
| `SELLER_LANG` | Seller's language code for STT, TTS and templates | No | `gu-IN` | Gnani language codes. Templates exist for gu, hi and en only |
| `BUYER_LANG` | Buyer's language code | No | `hi-IN` | Same as above |
| `SELLER_VOICE` | Timbre v3.0 voice for speech heard by the seller | No | `Shivani` | Available voices in the Gnani docs (docs.gnani.ai) |
| `BUYER_VOICE` | Timbre v3.0 voice for speech heard by the buyer | No | `Avinash` | Same as above |

Notes:

- `MONGODB_URI`, `GNANI_API_KEY` and `GEMINI_API_KEY` are the only variables checked at start-up.
- `npm run eval` needs only `GEMINI_API_KEY` and exits naming it if it is not set.
- Tests do not read `.env`. They use fake values and mocked providers.
- The example file ships with `change-me` placeholders for the two keys. Replace them in `.env` only.
- A language code is the speaker's language. The message the other side hears is spoken in the other language and voice. Voices must be valid Timbre v3.0 names, because Gnani returns 400 for an unknown voice.

## frontend/.env

Optional. Copy with `cd frontend; copy .env.example .env` only if you change the API address.

| Variable | Purpose | Required | Default | Where to get it |
|---|---|---|---|---|
| `VITE_API_URL` | Base URL of the Pakka backend | No | `http://localhost:4000` | The address the backend serves from (its `PORT`). Vite exposes only variables that start with `VITE_`, and the value is public in the built bundle, so never put a secret in it |

## Adding or renaming a variable

Update, in the same change: the code that reads it (`backend/src/config.js`), both `.env.example` files, this file and the start-up check if it is required.
