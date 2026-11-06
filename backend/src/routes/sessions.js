import { Router } from "express";
import multer from "multer";
import { DealSession } from "../models/DealSession.js";
import { emptyLedger } from "../ledger.js";
import { runTurn, answerClarification, confirmDeal } from "../deal.js";
import { HttpError } from "../errors.js";

const SPEAKERS = ["seller", "buyer"];
const MAX_TEXT = 1000;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) =>
    /wav/i.test(file.mimetype) ? cb(null, true) : cb(new HttpError(415, "Audio must be a WAV file. Record again or type the message instead.")),
}).single("audio");

const isWav = (b) => b.length > 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WAVE";

const MAX_CLIP_SECONDS = 25.5;

// Clip length from the WAV header, or null when the header cannot be read.
function wavSeconds(b) {
  let byteRate = null;
  for (let pos = 12; pos + 8 <= b.length;) {
    const id = b.toString("ascii", pos, pos + 4);
    const size = b.readUInt32LE(pos + 4);
    if (id === "fmt " && pos + 20 <= b.length) byteRate = b.readUInt32LE(pos + 16);
    if (id === "data") {
      // A streamed file can declare a size of 0 or 0xFFFFFFFF, so the real remaining bytes are used then.
      const bytes = size === 0 || size === 0xffffffff ? b.length - pos - 8 : size;
      return byteRate ? bytes / byteRate : null;
    }
    pos += 8 + size + (size % 2);
  }
  return null;
}

// In-process mutex per session id: requests for one session run one after another, so none reads a stale copy.
const locks = new Map();
async function withLock(id, fn) {
  const prev = locks.get(id) ?? Promise.resolve();
  let release;
  const mine = new Promise((r) => { release = r; });
  const tail = prev.then(() => mine);
  locks.set(id, tail);
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (locks.get(id) === tail) locks.delete(id);
  }
}

// Runs a mutating handler under the session lock, on a copy loaded after the lock is held.
const locked = (handler) => (req, res) =>
  withLock(req.params.id, async () => {
    req.deal = await DealSession.findById(req.params.id);
    if (!req.deal) throw new HttpError(404, "Session not found. Start a new session.");
    return handler(req, res);
  });

export function sessionsRouter({ providers, config }) {
  const router = Router();

  router.param("id", async (req, _res, next, id) => {
    const found = /^[0-9a-f]{24}$/i.test(id) ? await DealSession.findById(id) : null;
    if (!found) return next(new HttpError(404, "Session not found. Start a new session."));
    req.deal = found;
    next();
  });

  router.post("/", async (_req, res) => {
    const session = await DealSession.create({ ledger: emptyLedger(), turns: [], pending: null });
    res.status(201).json(session.toJSON());
  });

  router.get("/", async (_req, res) => {
    const sessions = await DealSession.find().sort({ createdAt: -1 }).limit(20);
    res.json(sessions.map((s) => ({ id: String(s._id), createdAt: s.createdAt, status: s.status, turnCount: s.turns.length })));
  });

  router.get("/:id", (req, res) => res.json(req.deal.toJSON()));

  router.post("/:id/turns", upload, locked(async (req, res) => {
    const body = req.body ?? {};
    if (!SPEAKERS.includes(body.speaker)) throw new HttpError(400, "Speaker must be seller or buyer.");
    let text;
    let audio;
    if (req.file) {
      if (!isWav(req.file.buffer)) throw new HttpError(415, "That file is not a valid WAV recording. Record again or type the message instead.");
      if (wavSeconds(req.file.buffer) > MAX_CLIP_SECONDS) {
        throw new HttpError(400, "That recording is longer than 25 seconds. Record a shorter clip and send again.");
      }
      audio = req.file.buffer;
    } else {
      text = typeof body.text === "string" ? body.text.trim() : "";
      if (!text) throw new HttpError(400, "Send an audio recording or some text.");
      if (text.length > MAX_TEXT) throw new HttpError(400, `Text is longer than ${MAX_TEXT} characters. Shorten it and send again.`);
    }
    const result = await runTurn({ session: req.deal, speaker: body.speaker, text, audio, providers, cfg: config });
    await req.deal.save();
    res.json(result);
  }));

  router.post("/:id/clarify", locked(async (req, res) => {
    const { optionId, skip } = req.body ?? {};
    if (skip !== true && (typeof optionId !== "string" || !optionId || optionId.length > 64)) {
      throw new HttpError(400, "Send an optionId, or skip: true to leave the question unresolved.");
    }
    const result = await answerClarification({ session: req.deal, optionId, skip: skip === true, providers, cfg: config });
    await req.deal.save();
    res.json(result);
  }));

  router.post("/:id/confirm", locked(async (req, res) => {
    const result = await confirmDeal({ session: req.deal, providers, cfg: config });
    await req.deal.save();
    res.json(result);
  }));

  return router;
}
