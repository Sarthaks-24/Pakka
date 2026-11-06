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

  router.post("/:id/turns", upload, async (req, res) => {
    const body = req.body ?? {};
    if (!SPEAKERS.includes(body.speaker)) throw new HttpError(400, "Speaker must be seller or buyer.");
    let text;
    let audio;
    if (req.file) {
      if (!isWav(req.file.buffer)) throw new HttpError(415, "That file is not a valid WAV recording. Record again or type the message instead.");
      audio = req.file.buffer;
    } else {
      text = typeof body.text === "string" ? body.text.trim() : "";
      if (!text) throw new HttpError(400, "Send an audio recording or some text.");
      if (text.length > MAX_TEXT) throw new HttpError(400, `Text is longer than ${MAX_TEXT} characters. Shorten it and send again.`);
    }
    const result = await runTurn({ session: req.deal, speaker: body.speaker, text, audio, providers, cfg: config });
    await req.deal.save();
    res.json(result);
  });

  router.post("/:id/clarify", async (req, res) => {
    const { optionId, skip } = req.body ?? {};
    if (skip !== true && (typeof optionId !== "string" || !optionId || optionId.length > 64)) {
      throw new HttpError(400, "Send an optionId, or skip: true to leave the question unresolved.");
    }
    const result = await answerClarification({ session: req.deal, optionId, skip: skip === true, providers, cfg: config });
    await req.deal.save();
    res.json(result);
  });

  router.post("/:id/confirm", async (req, res) => {
    const result = await confirmDeal({ session: req.deal, providers, cfg: config });
    await req.deal.save();
    res.json(result);
  });

  return router;
}
