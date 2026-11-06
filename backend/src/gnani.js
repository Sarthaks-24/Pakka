// Gnani Prisma STT and Timbre TTS over REST, with a disk cache, one-at-a-time queue and retry.
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, access, rename, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readConfig } from "./config.js";
import { HttpError } from "./errors.js";

const STT_URL = "https://api.vachana.ai/stt/v3";
const TTS_URL = "https://api.vachana.ai/api/v1/tts/inference";
const CACHE_DIR = fileURLToPath(new URL("../.cache/", import.meta.url));
const RETRY_STATUS = new Set([429, 500, 503, 504]);
const BACKOFF_MS = [500, 1000, 2000];
const TIMEOUT_MS = 20000;

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

// Upstream error text is never forwarded: it could echo request details or a key.
function toHttpError(res) {
  const s = res.status;
  if (s === 401) return new HttpError(502, "Gnani rejected the API key. Check GNANI_API_KEY in backend/.env.");
  if (s === 402) return new HttpError(502, "Gnani says the account has no credit left. Add credit at app.gnani.ai/voice.");
  if (s === 403) return new HttpError(502, "This Gnani key is not allowed to use speech services. Check its scopes at app.gnani.ai/voice.");
  if (s === 429) return new HttpError(503, "Gnani is busy with another request. Wait a few seconds and try again.");
  if (s >= 500) return new HttpError(502, "Gnani did not answer. Try again in a moment.");
  return new HttpError(502, "Gnani rejected the request. Check the audio and language settings.");
}

const timeoutError = () => new HttpError(504, "Gnani took too long to answer. Try again in a moment.");

// Sends with retry on 429/500/503/504, timeouts and network errors. Other 4xx fail at once.
async function send(makeRequest) {
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await makeRequest(AbortSignal.timeout(TIMEOUT_MS));
    } catch (err) {
      if (attempt >= BACKOFF_MS.length) {
        throw err?.name === "TimeoutError" ? timeoutError() : new HttpError(502, "Could not reach Gnani. Check the internet connection and try again.");
      }
      await sleep(BACKOFF_MS[attempt]);
      continue;
    }
    if (res.ok) return res;
    if (!RETRY_STATUS.has(res.status) || attempt >= BACKOFF_MS.length) throw toHttpError(res);
    await sleep(BACKOFF_MS[attempt]);
  }
}

// Writes to a temp file and renames it, so a reader never sees a half-written cache file.
async function writeAtomic(file, data) {
  await mkdir(CACHE_DIR, { recursive: true });
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(tmp, data);
    await rename(tmp, file);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}

export async function stt(wavBuffer, lang) {
  const hash = sha256(wavBuffer, lang);
  const readCached = async () => JSON.parse(await readFile(sttPath(hash), "utf8")).transcript;
  if (await exists(sttPath(hash))) return { transcript: await readCached(), ms: 0, cached: true };
  const key = readConfig().gnaniKey;
  const started = Date.now();
  const job = await enqueue(async () => {
    // Another request may have filled the cache while this one waited in the queue.
    if (await exists(sttPath(hash))) return { transcript: await readCached(), cached: true };
    const res = await send((signal) => {
      const form = new FormData();
      form.append("audio_file", new Blob([wavBuffer], { type: "audio/wav" }), "audio.wav");
      form.append("model", "prisma-v3.0");
      form.append("language_code", lang);
      form.append("format", "transcribe");
      return fetch(STT_URL, { method: "POST", headers: { "X-API-Key-ID": key }, body: form, signal });
    });
    const body = await res.json().catch(() => null);
    if (!body || body.success === false) throw new HttpError(502, "Gnani returned no transcript. Try recording again.");
    const transcript = String(body.transcript ?? "").trim();
    await writeAtomic(sttPath(hash), JSON.stringify({ transcript }));
    return { transcript, cached: false };
  });
  return { transcript: job.transcript, ms: job.cached ? 0 : Date.now() - started, cached: job.cached };
}

export async function tts(text, lang, voice) {
  const hash = sha256(text, lang, voice);
  if (await exists(audioPath(hash))) return { hash, ms: 0, cached: true };
  const key = readConfig().gnaniKey;
  const started = Date.now();
  // shortcut: digits are sent as they are. Timbre reads numbers best as words, so convert them before real demos.
  const cached = await enqueue(async () => {
    // Another request may have filled the cache while this one waited in the queue.
    if (await exists(audioPath(hash))) return true;
    const res = await send((signal) =>
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
        signal,
      }),
    );
    let bytes;
    try {
      bytes = Buffer.from(await res.arrayBuffer());
    } catch (err) {
      throw err?.name === "TimeoutError" ? timeoutError() : new HttpError(502, "Gnani audio was cut off. Try again.");
    }
    if (!bytes.length) throw new HttpError(502, "Gnani returned empty audio. Try again.");
    await writeAtomic(audioPath(hash), bytes);
    return false;
  });
  return { hash, ms: cached ? 0 : Date.now() - started, cached };
}
