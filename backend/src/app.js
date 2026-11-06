import express from "express";
import { readFile } from "node:fs/promises";
import { readConfig } from "./config.js";
import { HttpError } from "./errors.js";
import * as gnani from "./gnani.js";
import * as llm from "./llm.js";
import { sessionsRouter } from "./routes/sessions.js";

const defaultProviders = { stt: gnani.stt, tts: gnani.tts, llm };

export function createApp({ providers = defaultProviders, config = readConfig() } = {}) {
  const app = express();
  app.disable("x-powered-by");

  app.use((req, res, next) => {
    if (config.frontendOrigins.includes(req.headers.origin)) {
      res.set({
        "Access-Control-Allow-Origin": req.headers.origin,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        Vary: "Origin",
      });
    }
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });
  app.use(express.json({ limit: "100kb" }));

  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  app.use("/api/sessions", sessionsRouter({ providers, config }));

  app.get("/api/audio/:hash", async (req, res) => {
    if (!/^[0-9a-f]{64}$/.test(req.params.hash)) throw new HttpError(400, "Audio id must be 64 hex characters.");
    let bytes;
    try {
      bytes = await readFile(gnani.audioPath(req.params.hash));
    } catch {
      throw new HttpError(404, "Audio not found. It may not have been generated yet.");
    }
    res.type("audio/wav").send(bytes);
  });

  app.use((_req, _res, next) => next(new HttpError(404, "Route not found.")));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...err.extra });
    if (err?.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: "Audio is larger than 2 MB. Record a shorter clip." });
    if (err?.name === "MulterError") return res.status(400).json({ error: "The upload was not accepted. Send one WAV file in the audio field." });
    if (err?.type === "entity.parse.failed") return res.status(400).json({ error: "Request body is not valid JSON. Fix it and send again." });
    if (err?.type === "entity.too.large") return res.status(413).json({ error: "Request body is too large. Shorten it and send again." });
    // The error text can carry upstream details or a key, so only a status and a fixed code are logged.
    console.error("Unhandled error", { status: 500, code: "UNHANDLED" });
    res.status(500).json({ error: "Something went wrong on the server. Try again, and check the server log if it keeps happening." });
  });

  return app;
}
