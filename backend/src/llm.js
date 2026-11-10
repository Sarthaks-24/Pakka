// Gemini turn analysis. The model output is untrusted: it is validated and coerced here, then checked again by the ledger.
import { readFileSync } from "node:fs";
import { readConfig } from "./config.js";
import { HttpError } from "./errors.js";
import { FIELDS, NUMERIC_FIELDS, UNITS as CANON_UNITS, validDate } from "./ledger.js";

const SYSTEM_PROMPT = readFileSync(new URL("./prompts/analyse.md", import.meta.url), "utf8");
const UNITS = new Set(CANON_UNITS);
const ENUMS = { unit: UNITS, per: UNITS, currency: new Set(["INR", "USD"]), gst: new Set(["included", "extra"]) };
const TIMEOUT_MS = 20000;
// A busy model (500, 503) or a timeout is retried, so one Gemini hiccup does not fail the turn.
const ATTEMPTS = 3;
const RETRY_DELAY_MS = process.env.NODE_ENV === "test" || process.env.VITEST ? 0 : 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LLM_TYPES =new Set(["A7", "A9", "A10"]);

const str = (nullable = true) => ({ type: "STRING", nullable });
const num = { type: "NUMBER", nullable: true };
const obj = (properties) => ({ type: "OBJECT", nullable: true, properties });

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    translation: { type: "STRING" },
    terms: {
      type: "OBJECT",
      properties: {
        quantity: obj({ value: num, unit: str() }),
        product: obj({ name: str(), spec: str(), nameTranslated: str() }),
        price: obj({ amount: num, currency: str(), per: str(), gst: str() }),
        delivery: obj({ raw: str(), date: str(), candidates: { type: "ARRAY", items: { type: "STRING" } } }),
        payment: obj({ advancePct: num, balance: str() }),
      },
    },
    ambiguities: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          type: { type: "STRING" },
          slot: { type: "STRING" },
          quote: str(),
          options: {
            type: "ARRAY",
            items: { type: "OBJECT", properties: { label: { type: "STRING" }, field: { type: "STRING" }, value: { type: "STRING" } } },
          },
        },
      },
    },
  },
  required: ["translation", "terms", "ambiguities"],
};

function coerce(field, v, today) {
  if (v == null || v === "") return null;
  if (NUMERIC_FIELDS.has(field)) {
    const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, ""));
    return Number.isFinite(n) && n >= 0 ? n : null;
  }
  const s = String(v).trim().slice(0, 100);
  if (!s) return null;
  if (field === "date") return validDate(s, today) ? s : null;
  if (ENUMS[field]) {
    const lower = s.toLowerCase();
    const key = field === "currency" ? s.toUpperCase() : lower;
    return ENUMS[field].has(key) ? key : null;
  }
  return s;
}

// Keeps only known slots and fields with valid values.
export function sanitizeAnalysis(raw, today = new Date().toISOString().slice(0, 10)) {
  if (!raw || typeof raw.translation !== "string" || !raw.translation.trim()) {
    throw new HttpError(502, "The language model returned no translation. Try the turn again.");
  }
  const terms = {};
  for (const [slot, fields] of Object.entries(FIELDS)) {
    const given = raw.terms?.[slot];
    if (!given || typeof given !== "object") continue;
    const clean = {};
    for (const f of fields) {
      const v = coerce(f, given[f], today);
      if (v != null) clean[f] = v;
    }
    if (slot === "delivery" && Array.isArray(given.candidates)) {
      clean.candidates = given.candidates.filter((c) => typeof c === "string").slice(0, 5);
    }
    if (Object.keys(clean).length) terms[slot] = clean;
  }
  const ambiguities = [];
  for (const a of Array.isArray(raw.ambiguities) ? raw.ambiguities : []) {
    if (!LLM_TYPES.has(a?.type) || !FIELDS[a.slot]) continue;
    const options = [];
    for (const o of Array.isArray(a.options) ? a.options.slice(0, 4) : []) {
      const value = FIELDS[a.slot].includes(o?.field) ? coerce(o.field, o.value, today) : null;
      const label = typeof o?.label === "string" ? o.label.trim().slice(0, 80) : "";
      if (value != null && label) options.push({ label, patch: { [o.field]: value } });
    }
    ambiguities.push({ type: a.type, slot: a.slot, quote: typeof a.quote === "string" ? a.quote.slice(0, 200) : null, options });
  }
  return { translation: raw.translation.trim(), terms, ambiguities };
}

const brief = (ledger) =>
  Object.fromEntries(Object.entries(FIELDS).map(([slot, fields]) =>
    [slot, { status: ledger[slot].status, ...Object.fromEntries(fields.map((f) => [f, ledger[slot][f]])) }]));

export async function analyseTurn({ transcript, speakerLang, listenerLang, ledger, today }) {
  const { geminiKey, geminiModel, geminiThinkingLevel } = readConfig();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent`;
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: "user", parts: [{ text: JSON.stringify({ today, speakerLang, listenerLang, ledger: brief(ledger), transcript }) }] }],
    generationConfig: {
      responseMimeType: "application/json", responseSchema: RESPONSE_SCHEMA, temperature: 0,
      ...(geminiThinkingLevel && { thinkingConfig: { thinkingLevel: geminiThinkingLevel } }),
    },
  });
  let res;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    if (attempt > 1) await sleep(RETRY_DELAY_MS * (attempt - 1));
    const last = attempt === ATTEMPTS;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "x-goog-api-key": geminiKey, "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      if (err?.name !== "TimeoutError") throw new HttpError(502, "Could not reach Gemini. Check the internet connection and try again.");
      if (last) throw new HttpError(504, "Gemini took too long to answer. Try the turn again.");
      continue;
    }
    if ((res.status !== 500 && res.status !== 503) || last) break;
  }
  if (res.status === 401 || res.status === 403) {
    throw new HttpError(502, "Gemini rejected the API key. Check GEMINI_API_KEY in backend/.env.");
  }
  if (res.status === 400) throw new HttpError(502, "Gemini could not process that message. Shorten it and try again.");
  if (res.status === 404) throw new HttpError(502, "The model in GEMINI_MODEL was not found. Check the model name in backend/.env.");
  if (res.status === 429) throw new HttpError(503, "Gemini is rate limited. Wait a moment and try again.");
  if (!res.ok) throw new HttpError(502, "Gemini did not answer. Try again in a moment.");
  let raw;
  try {
    const body = await res.json();
    raw = JSON.parse(body.candidates?.[0]?.content?.parts?.[0]?.text ?? "");
  } catch {
    throw new HttpError(502, "Gemini returned an unreadable answer. Try the turn again.");
  }
  return sanitizeAnalysis(raw, today);
}
