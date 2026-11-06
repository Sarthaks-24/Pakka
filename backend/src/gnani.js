// Gnani Prisma STT and Timbre TTS over REST, with a disk cache, one-at-a-time queue and retry.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readConfig } from "./config.js";
import { HttpError } from "./errors.js";

const STT_URL = "https://api.vachana.ai/stt/v3";
const TTS_URL = "https://api.vachana.ai/api/v1/tts/inference";
const CACHE_DIR = fileURLToPath(new URL("../.cache/", import.meta.url));
const RETRY_STATUS = new Set([429, 500, 503, 504]);
const BACKOFF_MS = [500, 1000, 2000];

const sha256 = (...parts) => {
  const h = createHash("sha256");
  for (const p of parts) h.update(p).update("\0");
  return h.digest("hex");
};

export const audioPath = (hash) => path.join(CACHE_DIR, `${hash}.wav`);
const sttPath = (hash) => path.join(CACHE_DIR, `stt-${hash}.json`);
const exists = (p) => access(p).then(() => true, () => false);

// The docs allow one active request per key, so every Gnani call waits for the previous one.
let tail = Promise.resolve();
function enqueue(job) {
  const run = tail.then(job);
  tail = run.catch(() => {});
  return run;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function errorText(res) {
  try {
    const body = await res.json();
    const m = body?.error?.message ?? body?.message ?? body?.detail?.message ?? body?.detail;
    return typeof m === "string" ? m : JSON.stringify(m ?? "").slice(0, 200);
  } catch {
    return "";
  }
}

async function toHttpError(res) {
  const s = res.status;
  if (s === 401) return new HttpError(502, "Gnani rejected the API key. Check GNANI_API_KEY in backend/.env.");
  if (s === 402) return new HttpError(502, "Gnani says the account has no credit left. Add credit at app.gnani.ai/voice.");
  if (s === 403) return new HttpError(502, "This Gnani key is not allowed to use speech services. Check its scopes at app.gnani.ai/voice.");
  if (s === 429) return new HttpError(503, "Gnani is busy with another request. Wait a few seconds and try again.");
  if (s >= 500) return new HttpError(502, "Gnani did not answer. Try again in a moment.");
  const detail = await errorText(res);
  return new HttpError(502, `Gnani rejected the request${detail ? `: ${detail}` : ""}. Check the audio and language settings.`);
}

// Sends with retry on 429/500/503/504 and network errors. Other 4xx fail at once.
async function send(makeRequest) {
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await makeRequest();
    } catch {
      if (attempt >= BACKOFF_MS.length) throw new HttpError(502, "Could not reach Gnani. Check the internet connection and try again.");
      await sleep(BACKOFF_MS[attempt]);
      continue;
    }
    if (res.ok) return res;
    if (!RETRY_STATUS.has(res.status) || attempt >= BACKOFF_MS.length) throw await toHttpError(res);
    await sleep(BACKOFF_MS[attempt]);
  }
}

export async function stt(wavBuffer, lang) {
  const hash = sha256(wavBuffer, lang);
  if (await exists(sttPath(hash))) {
    const { transcript } = JSON.parse(await readFile(sttPath(hash), "utf8"));
    return { transcript, ms: 0, cached: true };
  }
  const key = readConfig().gnaniKey;
  const started = Date.now();
  const transcript = await enqueue(async () => {
    const res = await send(() => {
      const form = new FormData();
      form.append("audio_file", new Blob([wavBuffer], { type: "audio/wav" }), "audio.wav");
      form.append("model", "prisma-v3.0");
      form.append("language_code", lang);
      form.append("format", "transcribe");
      return fetch(STT_URL, { method: "POST", headers: { "X-API-Key-ID": key }, body: form });
    });
    const body = await res.json().catch(() => null);
    if (!body || body.success === false) throw new HttpError(502, "Gnani returned no transcript. Try recording again.");
    return String(body.transcript ?? "").trim();
  });
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(sttPath(hash), JSON.stringify({ transcript }));
  return { transcript, ms: Date.now() - started, cached: false };
}

export async function tts(text, lang, voice) {
  const hash = sha256(text, lang, voice);
  if (await exists(audioPath(hash))) return { hash, ms: 0, cached: true };
  const key = readConfig().gnaniKey;
  const started = Date.now();
  // shortcut: digits are sent as they are. Timbre reads numbers best as words, so convert them before real demos.
  const bytes = await enqueue(async () => {
    const res = await send(() =>
      fetch(TTS_URL, {
        method: "POST",
        headers: { "X-API-Key-ID": key, "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          voice,
          model: "timbre-v3.0",
          language: lang,
          speed: 1.0,
          audio_config: { sample_rate: 24000, num_channels: 1, sample_width: 2, encoding: "linear_pcm", container: "wav" },
        }),
      }),
    );
    return Buffer.from(await res.arrayBuffer());
  });
  if (!bytes.length) throw new HttpError(502, "Gnani returned empty audio. Try again.");
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(audioPath(hash), bytes);
  return { hash, ms: Date.now() - started, cached: false };
}
