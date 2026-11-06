// Pure deal ledger: slot state, number parsing and the deterministic ambiguity rules.
import { t, monthName, label } from "./templates.js";

export const FIELDS = {
  quantity: ["value", "unit"],
  product: ["name", "spec"],
  price: ["amount", "currency", "per", "gst"],
  delivery: ["date", "raw"],
  payment: ["advancePct", "balance"],
};
export const SLOTS = Object.keys(FIELDS);
export const UNITS = ["meter", "roll", "kg", "piece", "than", "dozen", "bale", "lot"];
export const NUMERIC_FIELDS = new Set(["value", "amount", "advancePct"]);
const UNSTABLE_UNITS = new Set(["roll", "than", "bale", "lot"]);
const SLOT_ORDER = ["product", "quantity", "price", "delivery", "payment"];
// Priority when several are pending: price, quantity, delivery, payment, then LLM-only spec and assent.
const PRIORITY = ["A4", "A5", "A8", "A10", "A1", "A2", "A3", "A6", "A7", "A9"];

export function emptyLedger() {
  const ledger = {};
  for (const [slot, fields] of Object.entries(FIELDS)) {
    ledger[slot] = { ...Object.fromEntries(fields.map((f) => [f, null])), status: "empty", rounds: 0, acks: [] };
  }
  return ledger;
}

// Merges non-null term fields. A slot that receives any term becomes ok; the caller re-marks it ambiguous.
export function applyTerms(ledger, terms) {
  const next = structuredClone(ledger);
  for (const [slot, fields] of Object.entries(FIELDS)) {
    const given = terms?.[slot];
    if (!given) continue;
    let touched = false;
    for (const f of fields) {
      const v = given[f];
      if (v == null) continue;
      touched = true;
      if (next[slot][f] !== v) {
        next[slot][f] = v;
        next[slot].acks = [];
      }
    }
    if (touched) {
      if (next[slot].status === "unresolved") next[slot].rounds = 0;
      next[slot].status = "ok";
    }
  }
  return next;
}

export function applyOption(ledger, ambiguity, optionId) {
  const option = ambiguity.options.find((o) => o.id === optionId);
  if (!option) throw new Error(`Unknown option ${optionId}`);
  const next = structuredClone(ledger);
  const slot = next[ambiguity.slot];
  Object.assign(slot, option.patch);
  if (!slot.acks.includes(ambiguity.type)) slot.acks.push(ambiguity.type);
  slot.status = "ok";
  slot.rounds = 0;
  return next;
}

const COMPLETE = {
  quantity: (s) => s.value != null && s.unit != null,
  product: (s) => s.name != null,
  price: (s) => s.amount != null && s.per != null && s.gst != null,
  delivery: (s) => s.date != null,
  payment: (s) => s.balance != null,
};

export function readiness(ledger) {
  const missing = SLOTS.filter((slot) => ledger[slot].status !== "ok" || !COMPLETE[slot](ledger[slot]));
  return { ready: missing.length === 0, missing };
}

export function sortAmbiguities(list) {
  return [...list].sort((a, b) => PRIORITY.indexOf(a.type) - PRIORITY.indexOf(b.type));
}

export function cardTerms(ledger) {
  const terms = {};
  for (const [slot, fields] of Object.entries(FIELDS)) {
    terms[slot] = Object.fromEntries(fields.map((f) => [f, ledger[slot][f]]));
  }
  terms.price.currency ??= "INR";
  return terms;
}

// ---- Number parsing ----

const WORDS = [
  [1, "ek one", "एक", "એક"], [2, "do doh two be", "दो", "બે"], [3, "teen three tran", "तीन", "ત્રણ"],
  [4, "char chaar four", "चार", "ચાર"], [5, "paanch panch five", "पांच पाँच", "પાંચ"], [6, "chhah chhe chha six", "छह छः छे", "છ"],
  [7, "saat seven", "सात", "સાત"], [8, "aath eight", "आठ", "આઠ"], [9, "nau nav nine", "नौ", "નવ"], [10, "das dus ten", "दस", "દસ"],
  [11, "gyarah eleven", "ग्यारह", "અગિયાર"], [12, "barah twelve", "बारह", "બાર"], [13, "terah thirteen", "तेरह", "તેર"],
  [14, "chaudah fourteen", "चौदह", "ચૌદ"], [15, "pandrah fifteen", "पंद्रह", "પંદર"], [16, "solah sixteen", "सोलह", "સોળ"],
  [17, "satrah seventeen", "सत्रह", "સત્તર"], [18, "atharah eighteen", "अठारह", "અઢાર"], [19, "unnis nineteen", "उन्नीस", "ઓગણીસ"],
  [20, "bees vis twenty", "बीस", "વીસ"], [30, "tees tris thirty", "तीस", "ત્રીસ"], [40, "chalis forty", "चालीस", "ચાલીસ"],
  [50, "pachas fifty", "पचास", "પચાસ"], [60, "saath sixty", "साठ", "સાઠ"], [70, "sattar seventy", "सत्तर", "સિત્તેર"],
  [80, "assi eighty", "अस्सी", "એંસી"], [90, "nabbe ninety", "नब्बे", "નેવું"],
];
const MULTS = [
  [100, "sau sao hundred", "सौ", "સો"], [1000, "hazaar hazar hajar hajaar thousand", "हज़ार हजार", "હજાર"],
  [100000, "lakh lakhs lac lacs", "लाख", "લાખ"], [10000000, "crore karod", "करोड़ करोड", "કરોડ"],
];
// abs: fixed value; add: offset applied to the next number; implicit: value when followed directly by a multiplier.
const MODS = [
  [{ abs: 1.5 }, "dedh derh", "डेढ़ डेढ", "દોઢ ડોઢ"],
  [{ abs: 2.5 }, "dhai adhai", "ढाई अढ़ाई", "અઢી"],
  [{ add: 0.25, implicit: 1.25 }, "sava", "सवा", "સવા"],
  [{ add: -0.25, implicit: 0.75 }, "paune", "पौने", "પોણા પોણો"],
  [{ add: 0.5 }, "saade sade saadhe", "साढ़े साढे", "સાડા"],
];

function table(rows) {
  const map = new Map();
  for (const [value, ...groups] of rows) {
    for (const w of groups.join(" ").split(/\s+/)) map.set(normalise(w), value);
  }
  return map;
}
const nukta = /[़਼]/g;
function normalise(text) {
  return text
    .toLowerCase()
    .replace(nukta, "")
    .replace(/[०-९]/g, (c) => c.charCodeAt(0) - 0x0966)
    .replace(/[૦-૯]/g, (c) => c.charCodeAt(0) - 0x0AE6);
}
const NUM = table(WORDS);
const MULT = table(MULTS);
const MOD = table(MODS);

// Returns every number found in the text, e.g. "dedh hazaar" gives [1500].
export function parseIndicNumbers(text) {
  const tokens = normalise(String(text ?? ""))
    .replace(/(\d)(\p{L})/gu, "$1 $2")
    .replace(/(\p{L})(\d)/gu, "$1 $2")
    .match(/[\p{L}\p{M}\p{N}]+(?:[.,]\p{N}+)*/gu) ?? [];
  const out = [];
  let total = 0, cur = null, afterHundred = false, mod = null, any = false;
  const flush = () => {
    if (any) out.push(total + (cur ?? 0));
    total = 0; cur = null; afterHundred = false; mod = null; any = false;
  };
  const bank = () => {
    if (cur !== null) total += cur;
    cur = null;
  };
  for (const tok of tokens) {
    const digits = /^\d+(?:[.,]\d+)*$/.test(tok) ? Number(tok.replace(/,/g, "")) : null;
    if (MOD.has(tok)) {
      const m = MOD.get(tok);
      bank();
      if (m.abs) { cur = m.abs; afterHundred = false; } else mod = m;
      any = true;
    } else if (digits !== null || NUM.has(tok)) {
      let n = digits ?? NUM.get(tok);
      if (mod) { n += mod.add; mod = null; cur = n; }
      else if (cur !== null && afterHundred && n < 100) cur += n;
      else if (cur !== null) { flush(); cur = n; }
      else cur = n;
      any = true;
      afterHundred = false;
    } else if (MULT.has(tok)) {
      const m = MULT.get(tok);
      let val;
      if (mod?.implicit && cur === null) val = mod.implicit * m;
      else val = (cur ?? 1) * m;
      mod = null;
      any = true;
      if (m >= 1000) { total += val; cur = null; afterHundred = false; }
      else { cur = val; afterHundred = true; }
    } else {
      flush();
    }
  }
  flush();
  return out;
}

// True when the speaker said this number, as digits or as number words.
// shortcut: Hindi and Gujarati number words from 21 to 99 (pachchees, tetalis) are not in the word table, so a value spoken that way
// is dropped and the slot is asked again. Add the table if that shows up in real recordings.
export function numberSaid(value, transcript) {
  return parseIndicNumbers(transcript).some((n) => Math.abs(n - value) < 1e-6);
}

// Drops numbers the LLM produced that the speaker never said.
export function numberGuard(terms, transcript) {
  const safe = structuredClone(terms ?? {});
  for (const [slot, fields] of Object.entries(FIELDS)) {
    for (const f of fields) {
      if (NUMERIC_FIELDS.has(f) && safe[slot]?.[f] != null && !numberSaid(safe[slot][f], transcript)) safe[slot][f] = null;
    }
  }
  return safe;
}

// Lists the slot fields that the guard removed, so the caller can say so instead of staying silent.
export function droppedByGuard(raw, safe) {
  const out = [];
  for (const [slot, fields] of Object.entries(FIELDS)) {
    for (const f of fields) {
      if (NUMERIC_FIELDS.has(f) && raw?.[slot]?.[f] != null && safe[slot]?.[f] == null) out.push({ slot, field: f });
    }
  }
  return out;
}

// ---- Formatting ----

const unitName = (tt, unit) => tt.units[unit] ?? unit;
const perName = (tt, unit) => tt.perUnits?.[unit] ?? unitName(tt, unit);

export function formatDate(iso, lang) {
  if (!/^\d{4}-(0[1-9]|1[0-2])-\d{2}$/.test(String(iso))) return String(iso ?? "");
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${monthName(lang, m - 1)} ${y}`;
}

export function formatSlot(slot, value, lang) {
  const tt = t(lang);
  const v = value ?? {};
  switch (slot) {
    case "quantity":
      return [v.value, v.unit && unitName(tt, v.unit)].filter((x) => x != null).join(" ");
    case "product":
      return v.spec ? `${v.name} (${v.spec})` : (v.name ?? "");
    case "price": {
      const parts = [];
      if (v.amount != null) parts.push(`${v.amount} ${tt.currency[v.currency ?? "INR"]}`);
      if (v.per) parts.push(`${tt.per} ${perName(tt, v.per)}`);
      return [parts.join(" "), v.gst && tt.gst[v.gst]].filter(Boolean).join(", ");
    }
    case "delivery":
      return v.date ? formatDate(v.date, lang) : (v.raw ?? "");
    case "payment": {
      const parts = [];
      if (v.advancePct != null) parts.push(tt.advance(v.advancePct));
      if (v.balance) parts.push(`${tt.balanceWord} ${tt.balance[v.balance] ?? v.balance}`);
      return parts.join(", ");
    }
    default:
      return "";
  }
}

export function confirmedLine(ledger, slots, lang) {
  const tt = t(lang);
  const parts = slots.map((s) => `${tt.slots[s]} ${formatSlot(s, ledger[s], lang)}`);
  return `${tt.confirmed} ${parts.join("; ")}`;
}

export function cardText(ledger, lang) {
  const tt = t(lang);
  return [tt.cardTitle, ...SLOT_ORDER.map((s) => `${tt.slots[s]}: ${formatSlot(s, ledger[s], lang)}`)].join("\n");
}

// ---- Rules ----

const opt = (id, lbl, patch) => ({ id, label: lbl, patch });
const unitOptions = (field, units) =>
  units.map((u) => opt(u, label((l) => unitName(t(l), u)), { [field]: u }));

const RELATIVE = new RegExp(
  "\\b(next|this|coming|end of|after|before|tomorrow|agle|agla|agli|kal|parso|parson|aavta|aavti|aavto)\\b|अगले|अगला|अगली|आने वाले|कल|परसों|बाद|अंत|આવતા|આવતી|આવતો|કાલે|પરમ|પછી|છેલ્લે",
  "i",
);
const WEEKDAYS = [
  [0, /sunday|ravivar|रविवार|રવિવાર/i], [1, /monday|somvar|सोमवार|સોમવાર/i], [2, /tuesday|mangalvar|मंगलवार|મંગળવાર/i],
  [3, /wednesday|budhvar|बुधवार|બુધવાર/i], [4, /thursday|guruvar|veervar|गुरुवार|बृहस्पतिवार|ગુરુવાર/i],
  [5, /friday|shukravar|शुक्रवार|શુક્રવાર/i], [6, /saturday|shanivar|शनिवार|શનિવાર/i],
];
const DOLLAR = /dollar|usd|\$|डॉलर|ડોલર/i;
const CHANGE_WORDS = /\b(change[ds]?|revise[ds]?|new price|instead|badal\w*)\b|बदल|नया भाव|બદલ|નવો ભાવ/i;

const isoDay = (d) => d.toISOString().slice(0, 10);

export function validDate(s, today) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && isoDay(d) === s && s >= today && d - new Date(`${today}T00:00:00Z`) <= 400 * 864e5;
}

function nextWeekdays(today, weekday, count) {
  const d = new Date(`${today}T00:00:00Z`);
  do d.setUTCDate(d.getUTCDate() + 1); while (d.getUTCDay() !== weekday);
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push(isoDay(d));
    d.setUTCDate(d.getUTCDate() + 7);
  }
  return out;
}

export function dateCandidates(candidates, raw, today) {
  const valid = [...new Set((candidates ?? []).filter((c) => validDate(c, today)))].slice(0, 3);
  if (valid.length) return valid;
  const weekday = WEEKDAYS.find(([, re]) => re.test(raw ?? ""))?.[0] ?? 5;
  return nextWeekdays(today, weekday, 2);
}

// Rule-based ambiguities for the ledger as it would be after applying the terms.
export function checkTerms(terms, ledger, { transcript = "", today } = {}) {
  const next = applyTerms(ledger, terms);
  const quote = String(transcript).slice(0, 200) || null;
  const out = [];
  const add = (type, slot, q, options) => out.push({ id: `${type}:${slot}`, type, slot, quote: q ?? quote, options });
  const live = (slot) => next[slot].status !== "unresolved";
  const open = (slot, type) => live(slot) && !next[slot].acks.includes(type);

  const q = next.quantity, p = next.price, d = next.delivery, pay = next.payment;

  if (open("quantity", "A1") && q.value != null && q.unit == null) {
    add("A1", "quantity", null, unitOptions("unit", ["meter", "roll", "kg", "piece"]));
  }
  if (open("quantity", "A2") && q.unit && UNSTABLE_UNITS.has(q.unit)) {
    add("A2", "quantity", null, [
      opt("meter", label((l) => t(l).options.switchMeters), { unit: "meter" }),
      opt("keep", label((l) => t(l).options.keepUnit), { unit: q.unit }),
    ]);
  }
  if (open("delivery", "A3") && d.raw != null && (d.date == null || RELATIVE.test(d.raw))) {
    const dates = dateCandidates(terms?.delivery?.candidates, d.raw, today);
    add("A3", "delivery", d.raw, dates.map((iso, i) => opt(`d${i}`, label((l) => formatDate(iso, l)), { date: iso })));
  }
  if (open("price", "A4") && p.amount != null && p.gst == null) {
    add("A4", "price", null, ["included", "extra"].map((g) => opt(g, label((l) => t(l).gst[g]), { gst: g })));
  }
  if (open("price", "A5") && p.amount != null && p.per == null) {
    add("A5", "price", null, ["meter", "kg", "piece"].map((u) =>
      opt(u, label((l) => `${t(l).per} ${perName(t(l), u)}`), { per: u })));
  }
  if (open("payment", "A6") && pay.advancePct != null && pay.balance == null) {
    add("A6", "payment", null, Object.keys(t("en").balance).map((b, i) =>
      opt(`b${i}`, label((l) => t(l).balance[b]), { balance: b })));
  }
  const old = ledger.price;
  const newAmount = terms?.price?.amount;
  if (open("price", "A8") && old.status === "ok" && old.amount != null && newAmount != null
    && newAmount !== old.amount && !CHANGE_WORDS.test(transcript)) {
    const show = (amount) => label((l) => formatSlot("price", { ...p, amount }, l));
    add("A8", "price", null, [opt("old", show(old.amount), { amount: old.amount }), opt("new", show(newAmount), { amount: newAmount })]);
  }
  if (open("price", "A10") && p.amount != null && p.currency == null && DOLLAR.test(transcript)) {
    add("A10", "price", null, ["INR", "USD"].map((c) => opt(c, label((l) => t(l).currency[c]), { currency: c })));
  }
  return out;
}

