# Operations

## Running locally

Needs Node 22 (`.nvmrc`), a running MongoDB and the two keys in `backend/.env`. See `ENVIRONMENT.md`.

```powershell
# window 1: MongoDB, if it is not already a Windows service
mongod

# window 2: API
cd backend
npm install
npm run dev        # node --watch, restarts on file changes

# window 3: frontend
cd frontend
npm install
npm run dev        # http://localhost:5173
```

For a run without the file watcher use `npm start` in `backend`. For a production build of the frontend use `npm run build` and `npm run preview`.

Check the API: `curl.exe http://localhost:4000/api/health` should answer `{"ok":true}`.

Start-up failures:

| Message | Fix |
|---|---|
| `Missing required environment variable: ...` | Set the named variable in `backend/.env` |
| `Could not connect to MongoDB...` | Start MongoDB, or fix `MONGODB_URI` (waits 5 seconds before giving up) |
| Frontend shows "Server not reachable" | Start the backend, check `VITE_API_URL` and `FRONTEND_ORIGIN`, press Retry |

## Disk cache

Folder: `backend/.cache/` (git-ignored, created on first use).

| File | Contents | Key |
|---|---|---|
| `stt-<hash>.json` | The transcript for one recording | sha256 of the WAV bytes and language code |
| `<hash>.wav` | One synthesised audio clip | sha256 of text, language code and voice |

- The same recording or the same sentence is never paid for twice. Cached calls report 0 ms.
- The audio endpoint `/api/audio/:hash` serves the WAV files from here. Replay in the UI plays old audio from this folder.
- It is safe to delete the folder. The next call for each item goes to Gnani again and costs credits. Past sessions in MongoDB will then show turns whose audio is gone (404 on play).
- Do not commit it or share it. It holds synthetic speech and transcripts of what was said in your tests.
- Changing a voice or a language changes the TTS hash, so those clips are made again.
- The TTS cache key does not include the model name.

## Gnani limits and retries

- Gnani allows one active request per key by default and gives no `Retry-After` header. All STT and TTS calls go through one in-process queue, one at a time. A turn with a question makes calls in sequence, so a turn takes about the sum of its steps.
- A 429, 500, 503 or 504 response, or a network error, is retried up to 3 times after 0.5 s, 1 s and 2 s. Other 4xx responses fail at once.
- If retries run out: 429 becomes a 503 from this API ("Gnani is busy..."), other failures become a 502.
- Named failures: 401 (check `GNANI_API_KEY`), 402 (no credit left), 403 (key scopes).
- The queue lives in one Node process. Running two API processes with one key breaks the one-request rule.
- Credit cost per call has not been measured. Use text turns while testing: they skip STT. They still call Gemini and, for the reply, TTS.

## Replay mode

The Replay view lists the last 20 stored sessions, lets you step through the turns of one, and plays their saved audio from the cache. A warning banner always says "Replay. This is a stored session, not a live call." Never present a replay as a live run.

## Gemini

One call per turn. The model comes from `GEMINI_MODEL`. Errors: 400 or 403 (check the key), 404 (check the model name), 429 (rate limited, wait and retry). There is no retry on Gemini calls.

## Free-tier hosting options (not set up)

Nothing is deployed. These are options only. Check each provider's current free-tier terms before using them, and set a budget alert where one exists.

| Part | Options | Notes |
|---|---|---|
| API | Render free web service, or Railway free tier | Needs `MONGODB_URI`, both keys and `FRONTEND_ORIGIN` set as environment variables. Free instances can sleep, and their disk may not persist, so `backend/.cache/` would be lost and credits spent again |
| Frontend | Vercel or Netlify | Build command `npm run build`, output folder `dist`, set `VITE_API_URL` to the API address |
| Database | MongoDB Atlas free M0 | Allow the API host's IP, use the Atlas connection string as `MONGODB_URI` |

Pakka has no accounts or authentication. A public deployment lets anyone who finds the URL spend your Gnani and Gemini credits. Do not deploy it publicly without adding access control.

## Steps you must do yourself

1. Get the keys and put them in `backend/.env` yourself:
   - `GNANI_API_KEY` from app.gnani.ai/voice
   - `GEMINI_API_KEY` from aistudio.google.com
2. Install and start MongoDB, then:
   ```powershell
   cd backend
   copy .env.example .env
   npm install
   npm test
   npm run dev
   ```
3. In a second window:
   ```powershell
   cd frontend
   npm install
   npm test
   npm run build
   npm run dev
   ```
4. Run the evaluation and put the printed numbers in the README "Evaluation" table:
   ```powershell
   cd backend
   npm run eval
   ```
   Results are also written to `backend/eval/results.json`.
5. Live smoke test: open http://localhost:5173, hold the seller button and speak one Gujarati sentence, and check that Hindi audio plays for the buyer. Check by ear that the voices `Shivani` and `Avinash` sound right, and change `SELLER_VOICE` or `BUYER_VOICE` if not.
6. Ask a Gujarati speaker and a Hindi speaker to read every string in `backend/src/templates.js`, and fix what they flag.
7. Check your Gnani credit balance at app.gnani.ai/voice before and after the smoke test, and note the credits per call.
8. Before any push or deployment, run `git status` and confirm that no `.env`, key or `backend/.cache/` file is staged.
