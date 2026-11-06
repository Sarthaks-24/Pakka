// Turn orchestration: analyse, gate on ambiguities, ask one question at a time, release, confirm.
import {
  applyTerms, applyOption, checkTerms, numberGuard, sortAmbiguities,
  confirmedLine, readiness, cardText, cardTerms,
} from "./ledger.js";
import { t, label, sameLabel, question, shortLang } from "./templates.js";
import { HttpError } from "./errors.js";

const MAX_ROUNDS = 2;
// These cannot be re-derived from the ledger by rules, so they stay open until the speaker gives new terms for the slot.
const STICKY = new Set(["A7", "A8", "A9"]);

const other = (speaker) => (speaker === "seller" ? "buyer" : "seller");
const langOf = (cfg, speaker) => (speaker === "seller" ? cfg.sellerLang : cfg.buyerLang);
const voiceOf = (cfg, speaker) => (speaker === "seller" ? cfg.sellerVoice : cfg.buyerVoice);
const audioUrl = (hash) => `/api/audio/${hash}`;

export function todayIST() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
}

function fromLlm(a, ledger) {
  const slot = ledger[a.slot];
  if (slot.status === "unresolved" || slot.acks.includes(a.type)) return null;
  let options;
  if (a.type === "A10") {
    options = ["INR", "USD"].map((c) => ({ id: c, label: label((l) => t(l).currency[c]), patch: { currency: c } }));
  } else {
    if (a.type === "A7" && a.slot !== "product") return null;
    options = a.options.map((o, i) => ({ id: `o${i}`, label: sameLabel(o.label), patch: o.patch }));
    if (options.length < 2) return null;
  }
  return { id: `${a.type}:${a.slot}`, type: a.type, slot: a.slot, quote: a.quote, options };
}

export async function detectAmbiguities({ transcript, speakerLang, listenerLang, ledger, today, llm }) {
  const raw = await llm.analyseTurn({ transcript, speakerLang, listenerLang, ledger, today });
  const terms = numberGuard(raw.terms, transcript);
  const next = applyTerms(ledger, terms);
  const rules = checkTerms(terms, ledger, { transcript, today });
  const llmFound = (raw.ambiguities ?? []).map((a) => fromLlm(a, next)).filter(Boolean);
  const bySlot = new Map();
  // Rules come first so their options win when both flag the same slot.
  for (const a of sortAmbiguities(rules).concat(sortAmbiguities(llmFound))) {
    if (!bySlot.has(a.slot)) bySlot.set(a.slot, a);
  }
  return { translation: raw.translation, terms, ambiguities: sortAmbiguities([...bySlot.values()]) };
}

const hasValue = (slot) => Object.entries(slot).some(([k, v]) => !["status", "rounds", "acks"].includes(k) && v != null);

function setStatuses(ledger, queue, resolved) {
  for (const slot of resolved) {
    if (ledger[slot].status !== "unresolved") ledger[slot].status = hasValue(ledger[slot]) ? "ok" : "empty";
  }
  for (const a of queue) ledger[a.slot].status = "ambiguous";
}

// Saves the new state on the document (the route persists it) and speaks either the next question or the released text.
async function conclude({ session, cfg, providers, ledger, queue, resolved, turnIndex, speaker, turn }) {
  session.ledger = ledger;
  const original = session.turns[turnIndex];
  let extra;
  if (queue.length) {
    session.pending = { turnIndex, speaker, queue, resolved };
    const a = queue[0];
    const lang = langOf(cfg, speaker);
    const text = question(a.type, lang);
    const audio = await providers.tts(text, lang, voiceOf(cfg, speaker));
    turn.latency.ttsMs = (turn.latency.ttsMs ?? 0) + audio.ms;
    extra = {
      outcome: "clarify",
      clarification: {
        ambiguityId: a.id,
        slot: a.slot,
        type: a.type,
        question: { text, lang },
        options: a.options.map((o) => ({ id: o.id, label: o.label[shortLang(lang)] ?? o.label.en })),
        audioUrl: audioUrl(audio.hash),
      },
    };
  } else {
    session.pending = null;
    const lang = langOf(cfg, other(original.speaker));
    const done = [...new Set(resolved)];
    const text = done.length ? `${original.translation}\n${confirmedLine(ledger, done, lang)}` : original.translation;
    const audio = await providers.tts(text, lang, voiceOf(cfg, other(original.speaker)));
    original.status = "released";
    original.releasedText = text;
    original.audioHash = audio.hash;
    original.latency.ttsMs = (original.latency.ttsMs ?? 0) + audio.ms;
    extra = { outcome: "released", release: { text, lang, audioUrl: audioUrl(audio.hash) } };
  }
  const json = session.toJSON();
  return { session: json, turn: json.turns[session.turns.indexOf(turn)], ...extra };
}

export async function runTurn({ session, speaker, text, audio, providers, cfg, today = todayIST() }) {
  if (session.status === "confirmed") throw new HttpError(409, "This deal is already confirmed. Start a new session.");
  const pending = session.pending;
  if (pending && pending.speaker !== speaker) {
    throw new HttpError(409, `Waiting for the ${pending.speaker} to answer a question. Let them answer first.`);
  }
  const lang = langOf(cfg, speaker);
  let transcript = text;
  let sttMs = 0;
  if (audio) {
    const r = await providers.stt(audio, lang);
    transcript = r.transcript;
    sttMs = r.ms;
    if (!transcript) throw new HttpError(422, "No speech was heard in that recording. Hold the button, speak, and try again.");
  }
  const started = Date.now();
  const analysis = await detectAmbiguities({
    transcript, speakerLang: lang, listenerLang: langOf(cfg, other(speaker)), ledger: session.ledger, today, llm: providers.llm,
  });
  const llmMs = Date.now() - started;

  const ledger = applyTerms(session.ledger, analysis.terms);
  let queue = analysis.ambiguities;
  let resolved = [];
  if (pending) {
    // A voice or text turn from the pending speaker is a re-answer to the open question.
    const detected = new Map(analysis.ambiguities.map((a) => [a.slot, a]));
    const asked = pending.queue[0].slot;
    queue = [];
    resolved = [...pending.resolved];
    for (const old of pending.queue) {
      const again = detected.get(old.slot) ?? (STICKY.has(old.type) && !analysis.terms[old.slot] ? old : null);
      if (!again) {
        resolved.push(old.slot);
      } else if (old.slot === asked && ++ledger[old.slot].rounds >= MAX_ROUNDS) {
        ledger[old.slot].status = "unresolved";
      } else {
        queue.push(again);
      }
    }
    for (const a of analysis.ambiguities) if (!pending.queue.some((o) => o.slot === a.slot)) queue.push(a);
    queue = sortAmbiguities(queue);
  }
  setStatuses(ledger, queue, resolved);

  session.turns.push({
    speaker, lang, source: audio ? "voice" : "text", transcript, translation: analysis.translation,
    terms: analysis.terms, ambiguities: analysis.ambiguities, status: "held", releasedText: null, audioHash: null,
    latency: { sttMs, llmMs, ttsMs: 0 },
  });
  const turnIndex = session.turns.length - 1;
  return conclude({
    session, cfg, providers, ledger, queue, resolved, speaker,
    turnIndex: pending ? pending.turnIndex : turnIndex, turn: session.turns[turnIndex],
  });
}

export async function answerClarification({ session, optionId, skip, providers, cfg, today = todayIST() }) {
  const pending = session.pending;
  if (!pending) throw new HttpError(409, "No question is waiting. Send a new turn instead.");
  const [current, ...rest] = pending.queue;
  let ledger = structuredClone(session.ledger);
  const resolved = [...pending.resolved];
  if (skip) {
    ledger[current.slot].status = "unresolved";
  } else {
    if (!current.options.some((o) => o.id === optionId)) {
      throw new HttpError(400, "That option is not one of the choices. Pick a listed option or skip the question.");
    }
    ledger = applyOption(ledger, current, optionId);
    resolved.push(current.slot);
  }
  // Answering one slot can expose the next gap, for example price basis after GST.
  const known = new Set(rest.map((a) => a.slot));
  const found = checkTerms({}, ledger, { today }).filter((a) => !known.has(a.slot));
  const queue = sortAmbiguities([...rest, ...found]);
  setStatuses(ledger, queue, resolved);
  return conclude({
    session, cfg, providers, ledger, queue, resolved, speaker: pending.speaker,
    turnIndex: pending.turnIndex, turn: session.turns[pending.turnIndex],
  });
}

export async function confirmDeal({ session, providers, cfg }) {
  if (session.status === "confirmed") return { session: session.toJSON(), card: session.card };
  const { ready, missing } = readiness(session.ledger);
  if (!ready || session.pending) {
    throw new HttpError(409, `Cannot confirm yet. These terms are not settled: ${missing.join(", ")}. Answer the open question or say them again.`, { missing });
  }
  const card = { terms: cardTerms(session.ledger), text: {}, audioUrl: {}, confirmedAt: new Date().toISOString() };
  for (const speaker of ["seller", "buyer"]) {
    const lang = langOf(cfg, speaker);
    card.text[speaker] = cardText(session.ledger, lang);
    card.audioUrl[speaker] = audioUrl((await providers.tts(card.text[speaker], lang, voiceOf(cfg, speaker))).hash);
  }
  session.card = card;
  session.status = "confirmed";
  return { session: session.toJSON(), card };
}
